import { describe, expect, it, vi, type Mock } from "vitest";

import type { Env } from "../src/env";
import worker from "../src/index";
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
    ]);
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

  it("changes both on a config change", async () => {
    const a = await fpOf({});
    const b = await fpOf({ config: { schema: "<path>" } });
    expect(b.fp).not.toBe(a.fp);
    expect(b.fpShape).not.toBe(a.fpShape);
  });
});

describe("anti-abuse", () => {
  const limiter = (success: boolean) => ({
    limit: vi.fn(async (_options: { key: string }) => ({ success })),
  });
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
    const tripped = mockEnv({ RL: limiter(false), RL_HARD: limiter(true) } as Partial<Env>);
    expect((await send(tripped.env, extra, "FRA")).status).toBe(202);
    expect(quarantinedBlob(tripped.events)).toBe("1");

    // Rate is back to normal, but the cached quarantine entry is still there.
    const calm = mockEnv({ RL: limiter(true), RL_HARD: limiter(true) } as Partial<Env>);
    expect((await send(calm.env, extra, "FRA")).status).toBe(202);
    expect(quarantinedBlob(calm.events)).toBe("1");

    // Another colo is not affected.
    const other = mockEnv({ RL: limiter(true), RL_HARD: limiter(true) } as Partial<Env>);
    await send(other.env, extra, "SYD");
    expect(quarantinedBlob(other.events)).toBe("0");
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
      expect(point.blobs[16]).toBe("1");
    }
    expect(rejects.writeDataPoint).toHaveBeenCalledTimes(total - kept);
    expect(rejects.writeDataPoint.mock.calls[0][0].blobs).toEqual(["sampled-out"]);
  });
});
