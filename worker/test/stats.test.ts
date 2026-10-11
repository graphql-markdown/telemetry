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
  });
});

describe("GET /v1/stats/catalog", () => {
  it("returns top shapes by debounced events with n < 5 suppressed", async () => {
    const shape = (id: string, debounced: number, last = "2026-10-20") =>
      db
        .prepare(
          "INSERT INTO config_catalog VALUES (?, ?, '1.0.0,1.1.0', '2026-10-01', ?, ?, ?, ?)",
        )
        .bind(id, JSON.stringify({ formatter: id }), last, debounced * 2, debounced, last);
    await db.batch([
      shape("a", 9),
      shape("b", 20),
      shape("c", 4),
      shape("old", 50, "2026-01-01"),
    ]);
    const body = (await (await get(`/v1/stats/catalog?${Q}`, token)).json()) as any;
    expect(body.configs.map((c: any) => c.config.formatter)).toEqual(["b", "a"]);
    expect(body.configs[0].versions).toEqual(["1.0.0", "1.1.0"]);
    expect(body.suppressed_count).toBe(1);
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
