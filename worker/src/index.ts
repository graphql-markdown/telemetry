import { readBody } from "./body";
import type { Env, RejectReason } from "./env";
import { fingerprints, formatterOf } from "./fingerprint";
import { validate } from "./schema";

type Json = Record<string, unknown>;

/** Reject counter: reason only, never any payload field. */
const reject = (env: Env, reason: RejectReason): Response => {
  env.REJECTS.writeDataPoint({ indexes: [reason], blobs: [reason], doubles: [1] });
  return new Response(null, { status: 204 });
};

const flag = (value: unknown): string => (value === true ? "1" : "0");

/** Config JSON beyond this size is replaced (AE allows 5120 bytes of blobs). */
const MAX_CONFIG_JSON = 3000;

/**
 * Blob order of a `gqlmd_events` data point (index 0 first):
 * event, fp, fpShape, pkg, pkgVersion, formatter, loader kinds (comma-joined),
 * os, pm, nodeMajor, graphqlMajor, ci, ciProvider, trigger, container, wsl,
 * quarantined, sanitized config JSON. Booleans are "1" or "0".
 */
export const buildBlobs = (
  payload: Json,
  fp: string,
  fpShape: string,
  quarantined: boolean,
): string[] => {
  const loader = payload.loader;
  const configJson = JSON.stringify(payload.config ?? {});
  return [
    String(payload.event),
    fp,
    fpShape,
    String(payload.pkg),
    String(payload.pkgVersion),
    formatterOf(payload),
    Array.isArray(loader) ? loader.join(",") : String(loader ?? ""),
    String(payload.os),
    String(payload.pm),
    String(payload.nodeMajor),
    String(payload.graphqlMajor),
    flag(payload.ci),
    String(payload.ciProvider ?? ""),
    String(payload.trigger),
    flag(payload.container),
    flag(payload.wsl),
    flag(quarantined),
    configJson.length > MAX_CONFIG_JSON ? '{"truncated":true}' : configJson,
  ];
};

const isRetired = (env: Env, version: unknown): boolean => {
  const retired = (env.RETIRED_VERSIONS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return retired.includes(String(version));
};

const QUARANTINE_TTL_SECONDS = 3600;

/** Cache API key for a quarantine entry. The Cache API needs a URL. */
const quarantineRequest = (fp: string, colo: string): Request => {
  return new Request(`https://quarantine.invalid/quarantine:${fp}:${colo}`);
};

/**
 * Anti-abuse for one `(fp, colo)`. `colo` is used in memory and in the cache
 * key only, never stored. Returns "drop" above the hard ceiling, otherwise
 * whether the event is quarantined (an active entry, or the limit just tripped).
 */
const checkAbuse = async (
  request: Request,
  env: Env,
  fp: string,
): Promise<"drop" | "quarantined" | "ok"> => {
  const colo = coloOf(request);
  const key = `${fp}:${colo}`;
  if (env.RL_HARD && !(await env.RL_HARD.limit({ key })).success) {
    return "drop";
  }
  const cache = caches.default;
  const entry = quarantineRequest(fp, colo);
  let quarantined = (await cache.match(entry)) !== undefined;
  if (env.RL && !(await env.RL.limit({ key })).success) {
    quarantined = true;
    // Written (and so renewed) every time the limit trips.
    await cache.put(
      entry,
      new Response(null, {
        headers: { "cache-control": `max-age=${QUARANTINE_TTL_SECONDS}` },
      }),
    );
  }
  return quarantined ? "quarantined" : "ok";
};

const coloOf = (request: Request): string => {
  return (request as { cf?: { colo?: string } }).cf?.colo ?? "x";
};

const ingest = async (request: Request, env: Env): Promise<Response> => {
  // Cheap flood check before any body work. Independent of the payload, so
  // varying a field to get a new fp cannot bypass it. Key: colo only.
  if (
    env.RL_COLO &&
    !(await env.RL_COLO.limit({ key: `colo:${coloOf(request)}` })).success
  ) {
    return reject(env, "rate-limit-colo");
  }
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    return reject(env, "schema");
  }
  const body = await readBody(request);
  if (!body.ok) {
    return reject(env, body.reason);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return reject(env, "schema");
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    isRetired(env, (payload as Json).v)
  ) {
    return new Response(null, { status: 410 });
  }
  const result = validate(payload);
  if (!result.ok) {
    return reject(env, result.reason);
  }
  const { fp, fpShape } = await fingerprints(result.value);
  const abuse = await checkAbuse(request, env, fp);
  if (abuse === "drop") {
    return reject(env, "rate-limit");
  }
  env.EVENTS.writeDataPoint({
    indexes: [fp],
    blobs: buildBlobs(result.value, fp, fpShape, abuse === "quarantined"),
    doubles: [1],
  });
  return new Response(null, { status: 202 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/event") {
      return new Response("Not Found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }
    return ingest(request, env);
  },
} satisfies ExportedHandler<Env>;
