import { env as testEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAccessCache } from "../src/access";
import type { Env } from "../src/env";
import worker from "../src/index";
import { AUD, mockJwks, signToken, TEAM } from "./access-helpers";
import { applyMigrations } from "./helpers";

const db = (testEnv as unknown as { DB: D1Database }).DB;
const env = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as unknown as Env;

const get = async (path: string, token?: string) => {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers["Cf-Access-Jwt-Assertion"] = token;
  return worker.fetch(new Request(`https://telemetry.test${path}`, { headers }), env);
};

let token: string;

const count = (day: string, ci: string, dim: string, value: string, measure: string, n: number) =>
  db
    .prepare("INSERT INTO daily_counts (day, ci, dim, value, measure, n) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(day, ci, dim, value, measure, n);

beforeEach(async () => {
  await applyMigrations(db);
  await db.batch([
    db.prepare("DELETE FROM daily_counts"),
    db.prepare("DELETE FROM config_catalog"),
    db.prepare("DELETE FROM config_catalog_daily"),
    db.prepare("DELETE FROM rejects_daily"),
  ]);
  resetAccessCache();
  await mockJwks();
  token = await signToken();
});
afterEach(() => vi.restoreAllMocks());

const Q = "from=2026-10-01&to=2026-10-31";

describe("access", () => {
  it("answers 403 without the Access JWT header", async () => {
    expect((await get(`/v1/stats?dim=os&${Q}`)).status).toBe(403);
    expect((await get("/v1/stats/catalog")).status).toBe(403);
    expect((await get("/v1/stats/rejects", "garbage")).status).toBe(403);
  });

  it("rejects non-GET methods", async () => {
    const res = await worker.fetch(
      new Request("https://telemetry.test/v1/stats", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("parameter validation", () => {
  it.each([
    "dim=nope",
    "",
    "dim=os&measure=bogus",
    "dim=os&view=bogus",
    "dim=os&from=2026-13-01",
    "dim=os&from=2026-02-30",
    "dim=os&from=20261001",
    "dim=os&from=2026-10-31&to=2026-10-01",
    "dim=os&from=2010-01-01&to=2026-10-01",
    "dim=setting.",
    "dim=setting.a.b",
  ])("answers 400 for %s", async (query) => {
    const res = await get(`/v1/stats?${query}`, token);
    expect(res.status).toBe(400);
  });

  it("accepts the allowlist, setting.* and a 3650-day range", async () => {
    for (const dim of ["event", "loader.kind", "setting.formatter"]) {
      expect((await get(`/v1/stats?dim=${dim}&${Q}`, token)).status).toBe(200);
    }
    const res = await get("/v1/stats?dim=os&from=2016-10-31&to=2026-10-29", token);
    expect(res.status).toBe(200);
  });

  it("rejects SQL injection attempts with 400 and leaves the data intact", async () => {
    await db.batch([count("2026-10-05", "0", "os", "linux", "raw", 9)]);
    const attempts = [
      "dim=os'%20OR%20'1'='1",
      "dim=os;DROP%20TABLE%20daily_counts",
      "dim=setting.x'--",
      "dim=os&measure=raw'%20OR%201=1--",
      "dim=os&view=all'%3B--",
      "dim=os&from=2026-10-01'%20OR%20'1'='1&to=2026-10-31",
      "dim=os&to=2026-10-31;DELETE%20FROM%20daily_counts",
    ];
    for (const query of attempts) {
      expect((await get(`/v1/stats?${query}`, token)).status).toBe(400);
    }
    for (const path of ["catalog", "rejects"]) {
      const res = await get(`/v1/stats/${path}?from=2026-10-01'%20OR%201=1--`, token);
      expect(res.status).toBe(400);
    }
    const { results } = await db.prepare("SELECT n FROM daily_counts").all();
    expect(results).toHaveLength(1);
  });
});

describe("GET /v1/stats", () => {
  it("shows a value whose range total reaches 5 though each day is below (3 + 3 = 6)", async () => {
    await db.batch([
      count("2026-10-05", "0", "os", "linux", "raw", 3),
      count("2026-10-06", "0", "os", "linux", "raw", 3),
      count("2026-10-05", "0", "os", "win32", "raw", 4),
      count("2026-10-06", "0", "os", "darwin", "raw", 1),
    ]);
    const body = (await (await get(`/v1/stats?dim=os&${Q}`, token)).json()) as any;
    expect(body.totals).toEqual([{ value: "linux", n: 6 }]);
    expect(body.series).toEqual([
      { day: "2026-10-05", value: "linux", n: 3 },
      { day: "2026-10-06", value: "linux", n: 3 },
    ]);
    expect(body.suppressed_count).toBe(2);
  });

  it("filters by measure, range and view", async () => {
    await db.batch([
      count("2026-10-05", "0", "os", "linux", "raw", 10),
      count("2026-10-05", "1", "os", "linux", "raw", 20),
      count("2026-10-05", "0", "os", "linux", "debounced_1d", 7),
      count("2026-10-05", "0", "os", "linux", "quarantined", 6),
      count("2026-10-05", "0", "os", "linux", "colo_sampled", 9),
      count("2026-09-05", "0", "os", "linux", "raw", 100),
    ]);
    const total = async (query: string) =>
      ((await (await get(`/v1/stats?dim=os&${Q}&${query}`, token)).json()) as any).totals[0]?.n;
    expect(await total("")).toBe(10);
    expect(await total("view=local")).toBe(10);
    expect(await total("view=ci")).toBe(20);
    expect(await total("view=all")).toBe(30);
    expect(await total("measure=debounced_1d")).toBe(7);
    expect(await total("measure=quarantined")).toBe(6);
    expect(await total("measure=colo_sampled")).toBe(9);
  });

  it("accepts the target dimension", async () => {
    await db.batch([count("2026-10-05", "0", "target", "docusaurus", "raw", 8)]);
    const res = await get(`/v1/stats?dim=target&${Q}`, token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).totals[0]).toMatchObject({ value: "docusaurus", n: 8 });
  });
});

describe("GET /v1/stats/catalog", () => {
  const shape = (id: string, allTime: number) =>
    db
      .prepare(
        "INSERT INTO config_catalog VALUES (?, ?, '1.0.0,1.1.0', '2026-01-01', '2026-10-20', ?, ?, '2026-10-20')",
      )
      .bind(id, JSON.stringify({ formatter: id }), allTime * 2, allTime);
  const daily = (day: string, id: string, debounced: number, ci = "0") =>
    db
      .prepare("INSERT INTO config_catalog_daily VALUES (?, ?, ?, ?, ?)")
      .bind(day, id, ci, debounced * 2, debounced);

  it("suppresses within the range, not on all-time totals, and ranks by in-range counts", async () => {
    await db.batch([
      shape("a", 9),
      shape("b", 20),
      shape("c", 10),
      shape("d", 50),
      daily("2026-10-02", "a", 9),
      daily("2026-10-03", "b", 20),
      daily("2026-10-04", "c", 1),
      daily("2026-09-01", "c", 9),
      daily("2026-10-05", "d", 3),
      daily("2026-10-06", "d", 3),
    ]);
    const body = (await (await get(`/v1/stats/catalog?${Q}`, token)).json()) as any;
    expect(body.configs.map((c: any) => c.config.formatter)).toEqual(["b", "a", "d"]);
    expect(body.configs[2].debounced_events).toBe(6);
    expect(body.configs[0].versions).toEqual(["1.0.0", "1.1.0"]);
    expect(body.suppressed_count).toBe(1);
  });

  it("filters by view", async () => {
    await db.batch([shape("a", 9), daily("2026-10-02", "a", 9, "1")]);
    const local = (await (await get(`/v1/stats/catalog?${Q}`, token)).json()) as any;
    expect(local.configs).toHaveLength(0);
    const ci = (await (await get(`/v1/stats/catalog?${Q}&view=ci`, token)).json()) as any;
    expect(ci.configs).toHaveLength(1);
  });
});

describe("GET /v1/stats/rejects", () => {
  it("returns reason counters", async () => {
    await db.batch([
      db.prepare("INSERT INTO rejects_daily VALUES ('2026-10-05', 'schema', 3)"),
      db.prepare("INSERT INTO rejects_daily VALUES ('2026-10-06', 'schema', 4)"),
      db.prepare("INSERT INTO rejects_daily VALUES ('2026-10-06', 'size', 1)"),
    ]);
    const body = (await (await get(`/v1/stats/rejects?${Q}`, token)).json()) as any;
    expect(body.totals).toEqual([
      { reason: "schema", n: 7 },
      { reason: "size", n: 1 },
    ]);
    expect(body.series).toHaveLength(3);
  });
});

describe("public aggregates", () => {
  const pub = (path: string, vars: Partial<Env> = {}, init?: RequestInit) =>
    worker.fetch(new Request(`https://telemetry.test${path}`, init), {
      DB: db,
      ASSETS: { fetch: async () => new Response("<h1>public</h1>") },
      ...vars,
    } as unknown as Env);

  it("answers 404 by default and when PUBLIC_STATS is not true", async () => {
    for (const vars of [{}, { PUBLIC_STATS: "false" }, { PUBLIC_STATS: "1" }]) {
      expect((await pub("/public", vars)).status).toBe(404);
      expect((await pub("/public/v1/stats?dim=os", vars)).status).toBe(404);
    }
  });

  it("serves the page when enabled, without any Access header", async () => {
    const res = await pub("/public", { PUBLIC_STATS: "true" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("public");
  });

  it("forces raw, local and weekly buckets and still suppresses n < 5", async () => {
    await db.batch([
      // Mon 2026-10-05 and Sun 2026-10-11 share the week of 2026-10-05.
      count("2026-10-05", "0", "os", "linux", "raw", 3),
      count("2026-10-11", "0", "os", "linux", "raw", 3),
      count("2026-10-12", "0", "os", "linux", "raw", 2),
      count("2026-10-05", "1", "os", "linux", "raw", 500),
      count("2026-10-05", "0", "os", "linux", "debounced_1d", 500),
      count("2026-10-05", "0", "os", "win32", "raw", 4),
    ]);
    const res = await pub(`/public/v1/stats?dim=os&${Q}&measure=debounced_1d&view=all`, {
      PUBLIC_STATS: "true",
    });
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ measure: "raw", view: "local", granularity: "week" });
    expect(body.series).toEqual([
      { day: "2026-10-05", value: "linux", n: 6 },
      { day: "2026-10-12", value: "linux", n: 2 },
    ]);
    expect(body.totals).toEqual([{ value: "linux", n: 8 }]);
    expect(body.suppressed_count).toBe(1);
  });

  it("validates params, hides catalog and rejects, and rejects non-GET", async () => {
    const vars = { PUBLIC_STATS: "true" };
    expect((await pub("/public/v1/stats?dim=os'--", vars)).status).toBe(400);
    expect((await pub("/public/v1/stats/catalog", vars)).status).toBe(404);
    expect((await pub("/public/v1/stats/rejects", vars)).status).toBe(404);
    expect((await pub("/public", vars, { method: "POST" })).status).toBe(405);
  });
});
