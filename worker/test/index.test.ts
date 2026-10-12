import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Env } from "../src/env";
import worker, { QUARANTINE_MEMORY_MAX, resetQuarantineMemory } from "../src/index";
import { gzip, mockEnv, payload, post } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };

describe("routing", () => {
  it("returns 404 for unknown routes", async () => {
    const { env } = mockEnv();
    const res = await worker.fetch(new Request("https://telemetry.test/"), env);
    expect(res.status).toBe(404);
  });

  it("returns 405 for other methods on /v1/event", async () => {
    const { env } = mockEnv();
    const res = await worker.fetch(
      new Request("https://telemetry.test/v1/event"),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("roles", () => {
  const get = (path: string, role?: "ingest" | "dashboard", extra: Partial<Env> = {}) => {
    const { env } = mockEnv({ ROLE: role, PUBLIC_STATS: "true", ...extra } as Partial<Env>);
    return worker.fetch(new Request(`https://telemetry.test${path}`), env);
  };

  it("ingest answers 404 on the stats and dashboard routes", async () => {
    expect((await get("/v1/stats", "ingest")).status).toBe(404);
    expect((await get("/v1/stats/rejects", "ingest")).status).toBe(404);
    expect((await get("/", "ingest")).status).toBe(404);
  });

  it("ingest still serves /v1/event and /public", async () => {
    const { env, events } = mockEnv({ ROLE: "ingest" } as Partial<Env>);
    const res = await worker.fetch(post(JSON.stringify(payload()), JSON_HEADERS), env);
    expect(res.status).toBe(202);
    expect(events.writeDataPoint).toHaveBeenCalledTimes(1);
    expect((await get("/public/v1/stats", "ingest", { DB: undefined })).status).not.toBe(404);
  });

  it("ingest serves the public page from its assets, gated by PUBLIC_STATS", async () => {
    const ASSETS = { fetch: async () => new Response("<h1>public</h1>") };
    const page = await get("/public", "ingest", { ASSETS } as unknown as Partial<Env>);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("public");
    const off = await get("/public", "ingest", { ASSETS, PUBLIC_STATS: "false" } as unknown as Partial<Env>);
    expect(off.status).toBe(404);
  });

  it("dashboard answers 404 on /v1/event and /public", async () => {
    const { env, events } = mockEnv({ ROLE: "dashboard" } as Partial<Env>);
    const res = await worker.fetch(post(JSON.stringify(payload()), JSON_HEADERS), env);
    expect(res.status).toBe(404);
    expect(events.writeDataPoint).not.toHaveBeenCalled();
    expect((await get("/public", "dashboard")).status).toBe(404);
    expect((await get("/public/v1/stats", "dashboard")).status).toBe(404);
  });

  it("dashboard still checks the Access JWT on /v1/stats", async () => {
    expect((await get("/v1/stats", "dashboard")).status).toBe(403);
  });

  it("serves every route when ROLE is unset", async () => {
    expect((await get("/v1/stats")).status).toBe(403);
    const { env } = mockEnv();
    const res = await worker.fetch(post(JSON.stringify(payload()), JSON_HEADERS), env);
    expect(res.status).toBe(202);
  });
});

describe("POST /v1/event", () => {
  it("stores one data point and answers 202", async () => {
    const { env, events, rejects } = mockEnv();
    const res = await worker.fetch(post(JSON.stringify(payload()), JSON_HEADERS), env);
    expect(res.status).toBe(202);
    expect(events.writeDataPoint).toHaveBeenCalledTimes(1);
    expect(rejects.writeDataPoint).not.toHaveBeenCalled();
    const point = events.writeDataPoint.mock.calls[0][0];
    expect(point.doubles).toEqual([1]);
    const blobs: string[] = point.blobs;
    expect(point.indexes).toEqual([blobs[1]]);
    expect(blobs[0]).toBe("config");
    expect(blobs[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(blobs[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(blobs.slice(3)).toEqual([
      "@graphql-markdown/cli",
      "1.2.3",
      "@graphql-markdown/docusaurus",
      "url",
      "darwin",
      "npm",
      "24",
      "16",
      "0",
      "",
      "cli",
      "0",
      "0",
      "0",
      JSON.stringify(payload().config),
      "",
      "",
    ]);
  });

  describe("generate events", () => {
    const generate = (extra: Record<string, unknown> = {}) => {
      const { config: _config, cli: _cli, loader: _loader, ...rest } = payload() as Record<string, unknown>;
      return { ...rest, event: "generate", pages: 12, durationMs: 3400, ...extra };
    };

    it("writes errorType to blob20 and pages and duration to doubles", async () => {
      const { env, events } = mockEnv();
      const res = await worker.fetch(
        post(JSON.stringify(generate({ errorType: "post:TypeError:ENOENT" })), JSON_HEADERS),
        env,
      );
      expect(res.status).toBe(202);
      const point = events.writeDataPoint.mock.calls[0][0];
      expect(point.doubles).toEqual([1, 12, 3400]);
      expect(point.blobs).toHaveLength(20);
      expect(point.blobs[0]).toBe("generate");
      expect(point.blobs[17]).toBe("{}");
      expect(point.blobs[19]).toBe("post:TypeError:ENOENT");
    });

    it("stores an empty errorType on success", async () => {
      const { env, events } = mockEnv();
      await worker.fetch(post(JSON.stringify(generate()), JSON_HEADERS), env);
      const point = events.writeDataPoint.mock.calls[0][0];
      expect(point.blobs[19]).toBe("");
      expect(point.doubles).toEqual([1, 12, 3400]);
    });

    it.each([
      ["unknown errorType", generate({ errorType: "Boom" })],
      ["missing pages", generate({ pages: undefined })],
      ["config on generate", generate({ config: {} })],
      ["cli on generate", generate({ cli: { force: true } })],
      ["loader on generate", generate({ loader: "url" })],
      ["pages out of range", generate({ pages: 1_000_001 })],
      ["non-integer pages", generate({ pages: 1.5 })],
      ["durationMs not a multiple of 100", generate({ durationMs: 3410 })],
      ["durationMs out of range", generate({ durationMs: 86_400_100 })],
      ["generate field on a config event", payload({ durationMs: 100 })],
    ])("rejects %s with schema", async (_name, body) => {
      const { env, events, rejects } = mockEnv();
      const res = await worker.fetch(post(JSON.stringify(body), JSON_HEADERS), env);
      expect(res.status).toBe(204);
      expect(events.writeDataPoint).not.toHaveBeenCalled();
      expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["schema"]);
    });
  });

  it("accepts a gzip body", async () => {
    const { env, events } = mockEnv();
    const body = await gzip(JSON.stringify(payload()));
    const res = await worker.fetch(
      post(body, { ...JSON_HEADERS, "content-encoding": "gzip" }),
      env,
    );
    expect(res.status).toBe(202);
    expect(events.writeDataPoint).toHaveBeenCalledTimes(1);
  });

  it("rejects a gzip bomb with size", async () => {
    const { env, events, rejects } = mockEnv();
    const body = await gzip(JSON.stringify({ pad: "a".repeat(1_000_000) }));
    expect(body.byteLength).toBeLessThan(8 * 1024);
    const res = await worker.fetch(
      post(body, { ...JSON_HEADERS, "content-encoding": "gzip" }),
      env,
    );
    expect(res.status).toBe(204);
    expect(events.writeDataPoint).not.toHaveBeenCalled();
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["size"]);
  });

  it("rejects an oversized wire body with size", async () => {
    const { env, rejects } = mockEnv();
    const res = await worker.fetch(post("x".repeat(9000), JSON_HEADERS), env);
    expect(res.status).toBe(204);
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["size"]);
  });

  it("rejects other encodings with encoding", async () => {
    const { env, events, rejects } = mockEnv();
    const res = await worker.fetch(
      post(JSON.stringify(payload()), { ...JSON_HEADERS, "content-encoding": "br" }),
      env,
    );
    expect(res.status).toBe(204);
    expect(events.writeDataPoint).not.toHaveBeenCalled();
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["encoding"]);
  });

  it("rejects a leaking payload with schema and no payload fields", async () => {
    const { env, events, rejects } = mockEnv();
    const leaky = payload({ config: { schema: "https://secret.internal/graphql" } });
    const res = await worker.fetch(post(JSON.stringify(leaky), JSON_HEADERS), env);
    expect(res.status).toBe(204);
    expect(events.writeDataPoint).not.toHaveBeenCalled();
    const point = rejects.writeDataPoint.mock.calls[0][0];
    expect(point.blobs).toEqual(["schema"]);
    expect(JSON.stringify(point)).not.toContain("secret");
  });

  it("rejects invalid JSON and wrong content type with schema", async () => {
    const { env, rejects } = mockEnv();
    expect((await worker.fetch(post("{nope", JSON_HEADERS), env)).status).toBe(204);
    expect(
      (await worker.fetch(post("{}", { "content-type": "text/plain" }), env)).status,
    ).toBe(204);
    expect(rejects.writeDataPoint).toHaveBeenCalledTimes(2);
  });

  it("answers 410 for a retired version", async () => {
    const { env, events } = mockEnv({ RETIRED_VERSIONS: "0, 1" });
    const res = await worker.fetch(post(JSON.stringify(payload()), JSON_HEADERS), env);
    expect(res.status).toBe(410);
    expect(events.writeDataPoint).not.toHaveBeenCalled();
  });

  it("answers 204 schema-version for an unknown version", async () => {
    const { env, rejects } = mockEnv();
    const res = await worker.fetch(post(JSON.stringify(payload({ v: 9 })), JSON_HEADERS), env);
    expect(res.status).toBe(204);
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["schema-version"]);
  });

  it("never stores the IP or the User-Agent", async () => {
    const { env, events } = mockEnv();
    const ip = "203.0.113.77";
    const ua = "SuperSecretAgent/9.9";
    await worker.fetch(
      post(JSON.stringify(payload()), {
        ...JSON_HEADERS,
        "cf-connecting-ip": ip,
        "user-agent": ua,
        "x-forwarded-for": ip,
      }),
      env,
    );
    const stored = JSON.stringify(events.writeDataPoint.mock.calls);
    expect(stored).not.toContain(ip);
    expect(stored).not.toContain(ua);
  });
});

describe("body bounds", () => {
  const chunked = (chunks: Uint8Array[], pulled: { n: number }) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[pulled.n];
        pulled.n += 1;
        if (next === undefined) {
          controller.close();
        } else {
          controller.enqueue(next);
        }
      },
    });

  it("rejects on a large Content-Length before reading", async () => {
    const { env, rejects } = mockEnv();
    const pulled = { n: 0 };
    const body = chunked([new Uint8Array(10)], pulled);
    const res = await worker.fetch(
      post(body, { ...JSON_HEADERS, "content-length": "9000" }, { duplex: "half" }),
      env,
    );
    expect(res.status).toBe(204);
    expect(pulled.n).toBeLessThanOrEqual(1); // only the stream's initial prefetch
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["size"]);
  });

  it("stops reading a body whose Content-Length lies", async () => {
    const { env, rejects } = mockEnv();
    const pulled = { n: 0 };
    const chunks = Array.from({ length: 1000 }, () => new Uint8Array(1024));
    const res = await worker.fetch(
      post(chunked(chunks, pulled), { ...JSON_HEADERS, "content-length": "10" }, { duplex: "half" }),
      env,
    );
    expect(res.status).toBe(204);
    expect(pulled.n).toBeLessThan(30);
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["size"]);
  });

  it("stops early on a chunked gzip bomb", async () => {
    const { env, rejects } = mockEnv();
    const pulled = { n: 0 };
    const gz = await gzip(JSON.stringify({ pad: "a".repeat(5_000_000) }));
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < gz.length; i += 64) chunks.push(gz.slice(i, i + 64));
    // Tail chunks that must never be read.
    for (let i = 0; i < 1000; i += 1) chunks.push(new Uint8Array(1024));
    const res = await worker.fetch(
      post(chunked(chunks, pulled), { ...JSON_HEADERS, "content-encoding": "gzip" }, { duplex: "half" }),
      env,
    );
    expect(res.status).toBe(204);
    expect(pulled.n).toBeLessThan(chunks.length - 900);
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["size"]);
  });
});

describe("fingerprints", () => {
  const fpOf = async (extra: Record<string, unknown>) => {
    const { env, events } = mockEnv();
    await worker.fetch(post(JSON.stringify(payload(extra)), JSON_HEADERS), env);
    const blobs: string[] = events.writeDataPoint.mock.calls[0][0].blobs;
    return { fp: blobs[1], fpShape: blobs[2] };
  };

  it("ignores per-machine fields", async () => {
    const a = await fpOf({});
    const b = await fpOf({ os: "linux", nodeMajor: 22, pm: "bun", ci: true, trigger: "nuxt" });
    expect(b).toEqual(a);
  });

  it("changes fp but not fpShape on a version bump", async () => {
    const a = await fpOf({});
    const b = await fpOf({ pkgVersion: "1.3.0", graphqlMajor: 17 });
    expect(b.fp).not.toBe(a.fp);
    expect(b.fpShape).toBe(a.fpShape);
  });

  it("keeps fpShape stable across pkgVersion for config events", async () => {
    const config = { schema: "<path>" };
    const a = await fpOf({ config });
    const b = await fpOf({ config, pkgVersion: "2.0.0" });
    expect(b.fp).not.toBe(a.fp);
    expect(b.fpShape).toBe(a.fpShape);
  });

  it("changes fp but not fpShape on a different event or target", async () => {
    const config = { schema: "<path>" };
    const scaffold = await fpOf({ event: "create_scaffold", target: "hugo", config });
    const wire = await fpOf({ event: "create_wire", target: "hugo", config });
    const other = await fpOf({ event: "create_wire", target: "mkdocs", config });
    expect(scaffold.fp).not.toBe(wire.fp);
    expect(wire.fp).not.toBe(other.fp);
    expect(scaffold.fpShape).toBe(wire.fpShape);
    expect(wire.fpShape).toBe(other.fpShape);
  });

  it("stores the create target as blob19", async () => {
    const { env, events } = mockEnv();
    await worker.fetch(
      post(JSON.stringify(payload({ event: "create_scaffold", target: "hugo" })), JSON_HEADERS),
      env,
    );
    const blobs: string[] = events.writeDataPoint.mock.calls[0][0].blobs;
    expect(blobs).toHaveLength(20);
    expect(blobs[18]).toBe("hugo");
  });

  it("changes both on a config change", async () => {
    const a = await fpOf({});
    const b = await fpOf({ config: { schema: "<path>" } });
    expect(b.fp).not.toBe(a.fp);
    expect(b.fpShape).not.toBe(a.fpShape);
  });
});

describe("anti-abuse", () => {
  beforeEach(() => resetQuarantineMemory());
  afterEach(() => vi.useRealTimers());

  const limiter = (success: boolean) => ({
    limit: vi.fn(async (_options: { key: string }) => ({ success })),
  });
  /** In-memory KV mock; TTLs are not simulated. */
  const kv = () => {
    const store = new Map<string, string>();
    return {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string, _options?: unknown) => {
        store.set(key, value);
      }),
    };
  };
  const send = (env: Env, extra: Record<string, unknown>, colo = "AMS") =>
    worker.fetch(
      post(JSON.stringify(payload(extra)), JSON_HEADERS, { cf: { colo } }),
      env,
    );
  const quarantinedBlob = (events: { writeDataPoint: Mock }, call = 0) =>
    events.writeDataPoint.mock.calls[call][0].blobs[16];

  it("keys both limiters by fp and colo", async () => {
    const RL = limiter(true);
    const RL_HARD = limiter(true);
    const { env, events } = mockEnv({ RL, RL_HARD } as Partial<Env>);
    await send(env, { config: { schema: "<path>", id: "<string>" } }, "CDG");
    const fp = events.writeDataPoint.mock.calls[0][0].blobs[1];
    expect(RL.limit).toHaveBeenCalledWith({ key: `${fp}:CDG` });
    expect(RL_HARD.limit).toHaveBeenCalledWith({ key: `${fp}:CDG` });
    expect(quarantinedBlob(events)).toBe("0");
  });

  it("falls back to x when the colo is unknown", async () => {
    const RL = limiter(true);
    const { env } = mockEnv({ RL } as Partial<Env>);
    await worker.fetch(post(JSON.stringify(payload({ pkgVersion: "9.9.1" })), JSON_HEADERS), env);
    expect(RL.limit.mock.calls[0][0].key).toMatch(/:x$/);
  });

  it("flags quarantined events and keeps flagging them while the entry exists", async () => {
    const extra = { config: { schema: "<path>", baseURL: "<url>" } };
    const QUARANTINE = kv();
    const tripped = mockEnv({ RL: limiter(false), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    expect((await send(tripped.env, extra, "FRA")).status).toBe(202);
    expect(quarantinedBlob(tripped.events)).toBe("1");

    // Rate is back to normal, but the stored quarantine entry is still there.
    const calm = mockEnv({ RL: limiter(true), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    expect((await send(calm.env, extra, "FRA")).status).toBe(202);
    expect(quarantinedBlob(calm.events)).toBe("1");

    // Another colo is not affected.
    const other = mockEnv({ RL: limiter(true), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    await send(other.env, extra, "SYD");
    expect(quarantinedBlob(other.events)).toBe("0");
  });

  it("writes the quarantine key once, with a 1 h TTL, while the limit keeps tripping", async () => {
    const extra = { config: { schema: "<path>", baseURL: "<url>" } };
    const QUARANTINE = kv();
    const { env, events } = mockEnv({ RL: limiter(false), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    await send(env, extra, "FRA");
    await send(env, extra, "FRA");
    const fp = events.writeDataPoint.mock.calls[0][0].blobs[1];
    expect(QUARANTINE.put).toHaveBeenCalledTimes(1);
    expect(QUARANTINE.put).toHaveBeenCalledWith(`q:${fp}:FRA`, "1", { expirationTtl: 3600 });
    expect(quarantinedBlob(events, 1)).toBe("1");
  });

  it("answers from memory without reading KV once the key is known", async () => {
    const extra = { config: { schema: "<path>", baseURL: "<url>" } };
    const QUARANTINE = kv();
    const tripped = mockEnv({ RL: limiter(false), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    await send(tripped.env, extra, "FRA");
    expect(QUARANTINE.put).toHaveBeenCalledTimes(1);
    QUARANTINE.get.mockClear();
    const calm = mockEnv({ RL: limiter(true), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    await send(calm.env, extra, "FRA");
    await send(calm.env, extra, "FRA");
    expect(quarantinedBlob(calm.events, 1)).toBe("1");
    expect(QUARANTINE.get).not.toHaveBeenCalled();
    expect(QUARANTINE.put).toHaveBeenCalledTimes(1);
  });

  it("reads KV once on a trip and does not read it again before writing", async () => {
    const QUARANTINE = kv();
    const { env } = mockEnv({ RL: limiter(false), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    await send(env, { config: { schema: "<path>", baseURL: "<url>" } }, "FRA");
    expect(QUARANTINE.get).toHaveBeenCalledTimes(1);
    expect(QUARANTINE.put).toHaveBeenCalledTimes(1);
  });

  it("treats a failing KV as not quarantined, skips it for 5 minutes, and keeps memory quarantine", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    const QUARANTINE = {
      get: vi.fn(async () => {
        throw new Error("kv down");
      }),
      put: vi.fn(async () => {
        throw new Error("kv down");
      }),
    };
    const extra = { config: { schema: "<path>", baseURL: "<url>" } };
    const clean = mockEnv({ RL: limiter(true), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    expect((await send(clean.env, extra)).status).toBe(202);
    expect(quarantinedBlob(clean.events)).toBe("0");
    expect(QUARANTINE.get).toHaveBeenCalledTimes(1);

    // Breaker open: neither get nor put is called, the trip is still flagged.
    const tripped = mockEnv({ RL: limiter(false), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    expect((await send(tripped.env, extra)).status).toBe(202);
    expect(quarantinedBlob(tripped.events)).toBe("1");
    const calm = mockEnv({ RL: limiter(true), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    await send(calm.env, extra);
    expect(quarantinedBlob(calm.events)).toBe("1");
    expect(QUARANTINE.get).toHaveBeenCalledTimes(1);
    expect(QUARANTINE.put).not.toHaveBeenCalled();

    // After 5 minutes KV is tried again.
    vi.setSystemTime(new Date("2026-10-12T10:05:01Z"));
    const other = mockEnv({ RL: limiter(true), RL_HARD: limiter(true), QUARANTINE } as unknown as Partial<Env>);
    await send(other.env, { config: { schema: "<path>", id: "<string>" } }, "SYD");
    expect(QUARANTINE.get).toHaveBeenCalledTimes(2);
  });

  it("bounds the in-memory map", async () => {
    const { env } = mockEnv({ RL: limiter(false), RL_HARD: limiter(true) } as Partial<Env>);
    for (let i = 0; i < QUARANTINE_MEMORY_MAX + 5; i += 1) {
      await send(env, { pkgVersion: `1.0.${i}` });
    }
    // The oldest entry was evicted, so with RL calm it is no longer flagged.
    const calm = mockEnv({ RL: limiter(true), RL_HARD: limiter(true) } as Partial<Env>);
    await send(calm.env, { pkgVersion: "1.0.0" });
    expect(quarantinedBlob(calm.events)).toBe("0");
    await send(calm.env, { pkgVersion: `1.0.${QUARANTINE_MEMORY_MAX + 4}` });
    expect(quarantinedBlob(calm.events, 1)).toBe("1");
  });

  it("samples 1 in 20 above the hard ceiling, weighted, never a full drop", async () => {
    const { env, events, rejects } = mockEnv({
      RL: limiter(true),
      RL_HARD: limiter(false),
    } as Partial<Env>);
    const total = 2000;
    for (let i = 0; i < total; i += 1) {
      const res = await send(env, { config: { schema: "<path>", id: "<string>", force: true } });
      expect([202, 204]).toContain(res.status);
    }
    const kept = events.writeDataPoint.mock.calls.length;
    expect(kept).toBeGreaterThan(total / 20 / 2);
    expect(kept).toBeLessThan((total / 20) * 2);
    for (const [point] of events.writeDataPoint.mock.calls) {
      expect(point.doubles).toEqual([20]);
      expect(point.blobs[16]).toBe("1");
    }
    expect(rejects.writeDataPoint).toHaveBeenCalledTimes(total - kept);
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["sampled-out"]);
  });

  it("keeps weight 1 for normal traffic", async () => {
    const { env, events } = mockEnv({ RL: limiter(true), RL_HARD: limiter(true), RL_COLO: limiter(true) } as Partial<Env>);
    await send(env, { config: { schema: "<path>", id: "<string>", diffMethod: "NONE" } });
    expect(events.writeDataPoint.mock.calls[0][0].doubles).toEqual([1]);
    expect(quarantinedBlob(events)).toBe("0");
  });

  it("still writes a legitimate event from a quarantined colo, flagged, weight 1", async () => {
    const { env, events } = mockEnv({ RL: limiter(false), RL_HARD: limiter(true), RL_COLO: limiter(true) } as Partial<Env>);
    const res = await send(env, { config: { schema: "<path>", id: "<string>", homepage: "<path>" } }, "ORD");
    expect(res.status).toBe(202);
    expect(quarantinedBlob(events)).toBe("1");
    expect(events.writeDataPoint.mock.calls[0][0].doubles).toEqual([1]);
  });
});

describe("per-colo limit", () => {
  it("samples 1 in 50 when many distinct fps flood one colo", async () => {
    const RL_COLO = { limit: vi.fn(async (_options: { key: string }) => ({ success: false })) };
    const { env, events, rejects } = mockEnv({ RL_COLO } as Partial<Env>);
    const total = 5000;
    for (let i = 0; i < total; i += 1) {
      await worker.fetch(
        post(JSON.stringify(payload({ pkgVersion: `1.0.${i}` })), JSON_HEADERS, { cf: { colo: "LHR" } }),
        env,
      );
    }
    const kept = events.writeDataPoint.mock.calls.length;
    expect(kept).toBeGreaterThan(total / 50 / 2.5);
    expect(kept).toBeLessThan((total / 50) * 2.5);
    expect(RL_COLO.limit).toHaveBeenCalledWith({ key: "colo:LHR" });
    for (const [point] of events.writeDataPoint.mock.calls) {
      expect(point.doubles).toEqual([50]);
      // Flagged apart from clean ("0") and quarantined ("1") rows.
      expect(point.blobs[16]).toBe("2");
    }
    expect(rejects.writeDataPoint).toHaveBeenCalledTimes(total - kept);
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["sampled-out"]);
  });
});
