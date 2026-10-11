import { describe, expect, it } from "vitest";

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
