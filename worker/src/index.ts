import { verifyAccess } from "./access";
import { sendAlert } from "./alert";
import { readBody } from "./body";
import type { Env, RejectReason } from "./env";
import { fingerprints, formatterOf } from "./fingerprint";
import { previousDay, rollupDay } from "./rollup";
import { validate } from "./schema";
import { handleStats } from "./stats";

type Json = Record<string, unknown>;

/** Reject counter: reason only, never any payload field. */
const reject = (env: Env, reason: RejectReason): Response => {
  env.REJECTS.writeDataPoint({ indexes: [reason], blobs: [reason], doubles: [1] });
  return new Response(null, { status: 204 });
};

const flag = (value: unknown): string => (value === true ? "1" : "0");

/** Blob17 values: clean, quarantined, colo-sampled. */
export type AbuseState = "0" | "1" | "2";

/** Config JSON beyond this size is replaced (AE allows 5120 bytes of blobs). */
const MAX_CONFIG_JSON = 3000;

/**
 * Blob order of a `gqlmd_events` data point (index 0 first):
 * event, fp, fpShape, pkg, pkgVersion, formatter, loader kinds (comma-joined),
 * os, pm, nodeMajor, graphqlMajor, ci, ciProvider, trigger, container, wsl,
 * abuse state, sanitized config JSON, target (create preset, else ""; blob19).
 * Booleans are "1" or "0". The abuse state (blob17) is "0" clean, "1"
 * quarantined (per-(fp, colo) quarantine or RL_HARD flood) or "2" colo-sampled
 * (RL_COLO tripped, kept at 1/SAMPLE_COLO with that weight).
 */
export const buildBlobs = (
  payload: Json,
  fp: string,
  fpShape: string,
  abuseState: AbuseState,
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
    abuseState,
    configJson.length > MAX_CONFIG_JSON ? '{"truncated":true}' : configJson,
    String(payload.target ?? ""),
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

/** Sampling denominators when a flood ceiling trips. */
export const SAMPLE_HARD = 20;
export const SAMPLE_COLO = 50;

/** True with probability 1/n. */
const keepOneIn = (n: number): boolean => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % n === 0;
};

/**
 * Anti-abuse for one `(fp, colo)`. `colo` is used in memory and in the cache
 * key only, never stored. Above the hard ceiling the event is sampled, never
 * dropped outright: kept with probability 1/SAMPLE_HARD and weighted
 * accordingly (null when sampled out). Quarantine only sets a flag.
 */
const checkAbuse = async (
  request: Request,
  env: Env,
  fp: string,
): Promise<{ quarantined: boolean; weight: number } | null> => {
  const colo = coloOf(request);
  const key = `${fp}:${colo}`;
  let flooded = false;
  if (env.RL_HARD && !(await env.RL_HARD.limit({ key })).success) {
    if (!keepOneIn(SAMPLE_HARD)) {
      return null;
    }
    flooded = true;
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
  return {
    quarantined: quarantined || flooded,
    weight: flooded ? SAMPLE_HARD : 1,
  };
};

const coloOf = (request: Request): string => {
  return (request as { cf?: { colo?: string } }).cf?.colo ?? "x";
};

const ingest = async (request: Request, env: Env): Promise<Response> => {
  let coloWeight = 1;
  let coloSampled = false;
  // Cheap flood check before any body work. Independent of the payload, so
  // varying a field to get a new fp cannot bypass it. Key: colo only.
  if (
    env.RL_COLO &&
    !(await env.RL_COLO.limit({ key: `colo:${coloOf(request)}` })).success
  ) {
    // Sample instead of dropping, so a flood can't silence real traffic.
    if (!keepOneIn(SAMPLE_COLO)) {
      return reject(env, "sampled-out");
    }
    coloWeight = SAMPLE_COLO;
    coloSampled = true;
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
  if (abuse === null) {
    return reject(env, "sampled-out");
  }
  env.EVENTS.writeDataPoint({
    indexes: [fp],
    blobs: buildBlobs(
      result.value,
      fp,
      fpShape,
      abuse.quarantined ? "1" : coloSampled ? "2" : "0",
    ),
    // Weight: 1 normally, N when kept under 1/N sampling. Queries must use
    // SUM(_sample_interval * double1), never count().
    doubles: [abuse.weight * coloWeight],
  });
  return new Response(null, { status: 202 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/v1/stats" || url.pathname.startsWith("/v1/stats/")) {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }
      if (!(await verifyAccess(request, env))) {
        return new Response("Forbidden", { status: 403 });
      }
      return handleStats(url, env);
    }
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
  /** Daily cron (0 2 * * *): roll up day D-1 (UTC) into D1, alert on zero config events. */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const day = previousDay(controller.scheduledTime);
    const configEvents = await rollupDay(env, day);
    if (configEvents === 0) {
      await sendAlert(env, `gqlmd telemetry: no config events on ${day} (UTC)`);
    }
  },
} satisfies ExportedHandler<Env>;
