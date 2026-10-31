import { env as testEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { Env } from "../src/env";
import worker from "../src/index";
import { MAX_ROWS_PER_DAY, previousDay, rollupDay } from "../src/rollup";
import { applyMigrations } from "./helpers";

const DAY = "2026-10-10";
const db = (testEnv as unknown as { DB: D1Database }).DB;

type Fixtures = Record<string, Array<Record<string, string | number>>>;

/** Fixture key: the selected blob column, "colo:<column>", "quarantined", "catalog" or "rejects". */
const keyOf = (sql: string): string => {
  if (sql.includes("FROM gqlmd_rejects")) return "rejects";
  if (sql.includes("blob17 = '1'")) return "quarantined";
  if (sql.includes("blob17 = '2'")) return `colo:${/SELECT (blob\d+) AS value/.exec(sql)?.[1]}`;
  if (sql.includes("AS fp_shape")) return "catalog";
  if (sql.includes("AS error_type")) return "generate_errors";
  if (sql.includes("AS pages_p50")) return "generate";
  return /SELECT (blob\d+) AS value/.exec(sql)?.[1] ?? "unknown";
};

let sqls: string[];
let fetchMock: MockInstance<typeof fetch>;

const mockAe = (fixtures: Fixtures) => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/analytics_engine/sql")) {
      const sql = String((init as RequestInit).body);
      sqls.push(sql);
      const rows = (fixtures[keyOf(sql)] ?? []).map((row) => ({ ci: "0", ...row }));
      return Response.json({ data: rows });
    }
    return new Response(null, { status: 204 });
  });
};

const makeEnv = (extra: Partial<Env> = {}): Env =>
  ({
    DB: db,
    AE_SQL_TOKEN: "token",
    ACCOUNT_ID: "acct",
    ...extra,
  }) as unknown as Env;

const counts = async (day = DAY) => {
  const { results } = await db
    .prepare(
      "SELECT ci, dim, value, measure, n FROM daily_counts WHERE day = ? ORDER BY ci, dim, value, measure",
    )
    .bind(day)
    .all();
  return results;
};

const base: Fixtures = {
  blob1: [
    { value: "config", raw: 30, debounced_1h: 12, debounced_1d: 8 },
    { value: "create", raw: 4, debounced_1h: 3, debounced_1d: 3 },
  ],
  blob7: [
    { value: "url,code-file", raw: 10, debounced_1h: 5, debounced_1d: 4 },
    { value: "url", raw: 20, debounced_1h: 7, debounced_1d: 4 },
  ],
  blob18: [
    {
      value: '{"schema":"<url>","mode":"group","baseURL":"/x","skipDocDirective":true}',
      raw: 6,
      debounced_1h: 2,
      debounced_1d: 2,
    },
  ],
  quarantined: [{ value: "config", n: 500 }],
  catalog: [
    { fp_shape: "s1", version: "1.0.0", config: '{"schema":"<url>"}', events: 20, debounced: 6 },
    { fp_shape: "s1", version: "1.1.0", config: '{"schema":"<url>"}', events: 10, debounced: 4 },
  ],
  rejects: [{ reason: "schema", n: 3 }],
};

beforeEach(async () => {
  sqls = [];
  fetchMock = vi.spyOn(globalThis, "fetch");
  await applyMigrations(db);
  await db.batch([
    db.prepare("DELETE FROM daily_counts"),
    db.prepare("DELETE FROM config_catalog"),
    db.prepare("DELETE FROM rejects_daily"),
    db.prepare("DELETE FROM config_catalog_daily"),
    db.prepare("DELETE FROM generate_daily"),
    db.prepare("DELETE FROM generate_errors_daily"),
  ]);
});

afterEach(() => {
  fetchMock.mockRestore();
});

describe("previousDay", () => {
  it("returns the UTC day before", () => {
    expect(previousDay(Date.parse("2026-10-11T02:00:00Z"))).toBe("2026-10-10");
    expect(previousDay(Date.parse("2026-01-01T00:30:00Z"))).toBe("2025-12-31");
  });
});

describe("rollupDay", () => {
  it("calls the AE SQL API with the bearer token", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
  });

  it("writes weighted rows for every measure", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    const rows = await counts();
    const get = (dim: string, value: string, measure: string) =>
      rows.find((r) => r.dim === dim && r.value === value && r.measure === measure)?.n;
    expect(get("event", "config", "raw")).toBe(30);
    expect(get("event", "config", "debounced_1h")).toBe(12);
    expect(get("event", "config", "debounced_1d")).toBe(8);
    expect(get("event", "config", "quarantined")).toBe(500);
    // Loader lists are split and summed per kind.
    expect(get("loader.kind", "url", "raw")).toBe(30);
    expect(get("loader.kind", "code-file", "raw")).toBe(10);
    expect(get("loader.kind", "url", "debounced_1d")).toBe(8);
    // Settings keep enum and mask values only.
    expect(get("setting.schema", "<url>", "raw")).toBe(6);
    expect(get("setting.mode", "group", "raw")).toBe(6);
    expect(get("setting.skipDocDirective", "true", "raw")).toBe(6);
    expect(get("setting.baseURL", "/x", "raw")).toBeUndefined();
  });

  it("rolls up the create target for create events only", async () => {
    mockAe({
      blob19: [
        { value: "docusaurus", raw: 9, debounced_1h: 4, debounced_1d: 3 },
        { value: "", raw: 99, debounced_1h: 9, debounced_1d: 9 },
      ],
    });
    await rollupDay(makeEnv(), DAY);
    const targets = (await counts()).filter((r) => r.dim === "target");
    expect(targets.map((r) => r.value)).toEqual(["docusaurus", "docusaurus", "docusaurus"]);
    expect(targets.find((r) => r.measure === "raw")?.n).toBe(9);
    const sql = sqls.find((q) => q.includes("blob19 AS value")) ?? "";
    expect(sql).toContain("blob1 IN ('create_scaffold', 'create_wire')");
    expect(sql).toContain("blob19 != ''");
    expect(sql).toContain("blob17 = '0'");
  });

  it("keeps CI and local rows for the same config apart", async () => {
    mockAe({
      blob1: [
        { value: "config", ci: "0", raw: 5, debounced_1h: 2, debounced_1d: 2 },
        { value: "config", ci: "1", raw: 40, debounced_1h: 9, debounced_1d: 3 },
      ],
      quarantined: [{ value: "config", ci: "1", n: 7 }],
    });
    await rollupDay(makeEnv(), DAY);
    const rows = await counts();
    const get = (ci: string, measure: string) =>
      rows.find((r) => r.ci === ci && r.dim === "event" && r.value === "config" && r.measure === measure)?.n;
    expect(get("0", "raw")).toBe(5);
    expect(get("1", "raw")).toBe(40);
    expect(get("1", "debounced_1h")).toBe(9);
    expect(get("1", "quarantined")).toBe(7);
    expect(get("0", "quarantined")).toBeUndefined();
    const again = await rollupDay(makeEnv(), DAY);
    expect(again).toBe(45);
    expect(await counts()).toEqual(rows);
  });

  it("excludes quarantined rows from the measures", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    const measureSqls = sqls.filter((sql) => sql.includes("SUM(_sample_interval * double1) AS raw"));
    expect(measureSqls.length).toBeGreaterThan(0);
    for (const sql of measureSqls) {
      expect(sql).toContain("blob17 = '0'");
    }
    const quarantined = sqls.filter((sql) => sql.includes("blob17 = '1'"));
    expect(quarantined).toHaveLength(1);
    const rows = await counts();
    expect(rows.find((r) => r.value === "config" && r.measure === "raw" && r.dim === "event")?.n).toBe(30);
  });

  it("rolls up colo-sampled rows as their own measure, not in raw", async () => {
    mockAe({
      blob1: [{ value: "config", raw: 30, debounced_1h: 12, debounced_1d: 8 }],
      "colo:blob1": [{ value: "config", colo_sampled: 4 }],
    });
    await rollupDay(makeEnv(), DAY);
    const rows = await counts();
    const get = (measure: string) =>
      rows.find((r) => r.dim === "event" && r.value === "config" && r.measure === measure)?.n;
    expect(get("colo_sampled")).toBe(4);
    expect(get("raw")).toBe(30);
    const coloSqls = sqls.filter((sql) => sql.includes("blob17 = '2'"));
    expect(coloSqls.length).toBeGreaterThan(0);
    for (const sql of coloSqls) {
      expect(sql).toContain("SUM(_sample_interval * double1) AS colo_sampled");
      expect(sql).not.toContain("blob17 = '0'");
    }
    for (const sql of sqls.filter((q) => q.includes("AS raw"))) {
      expect(sql).not.toContain("blob17 = '2'");
    }
  });

  it("keeps quarantined rows on blob17 = '1' only", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    const quarantinedSqls = sqls.filter((sql) => sql.includes("blob17 = '1'"));
    expect(quarantinedSqls).toHaveLength(1);
    expect(quarantinedSqls[0]).not.toContain("colo_sampled");
    expect(quarantinedSqls[0]).not.toContain("blob17 = '2'");
    const rows = await counts();
    expect(rows.find((r) => r.value === "config" && r.measure === "quarantined")?.n).toBe(500);
    expect(rows.some((r) => r.measure === "colo_sampled")).toBe(false);
  });

  it("records rejects and the config catalog", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    const rejects = await db.prepare("SELECT reason, n FROM rejects_daily WHERE day = ?").bind(DAY).all();
    expect(rejects.results).toEqual([{ reason: "schema", n: 3 }]);
    const catalog = await db.prepare("SELECT * FROM config_catalog").all();
    expect(catalog.results).toEqual([
      {
        fp_shape: "s1",
        masked_config_json: '{"schema":"<url>"}',
        versions_seen: "1.0,1.1",
        first_seen: DAY,
        last_seen: DAY,
        events: 30,
        debounced_events: 10,
        last_rolled_day: DAY,
      },
    ]);
  });

  it("stores catalog configs with keys sorted at every level", async () => {
    mockAe({
      ...base,
      catalog: [
        {
          fp_shape: "s1",
          version: "1.0.0",
          config: '{"schema":"<url>","docOptions":{"index":true,"frontMatter":false}}',
          events: 20,
          debounced: 6,
        },
      ],
    });
    await rollupDay(makeEnv(), DAY);
    const row = await db.prepare("SELECT masked_config_json FROM config_catalog").first();
    expect(row?.masked_config_json).toBe('{"docOptions":{"frontMatter":false,"index":true},"schema":"<url>"}');
  });

  it("rewrites an unsorted catalog config on the next rollup", async () => {
    await db
      .prepare(
        `INSERT INTO config_catalog (fp_shape, masked_config_json, versions_seen, first_seen, last_seen, events, debounced_events, last_rolled_day)
         VALUES ('s1', '{"schema":"<url>","mode":"group"}', '1.0.0', '2026-10-01', '2026-10-01', 5, 2, '2026-10-01')`,
      )
      .run();
    mockAe({
      ...base,
      catalog: [{ fp_shape: "s1", version: "1.0.0", config: '{"schema":"<url>","mode":"group"}', events: 20, debounced: 6 }],
    });
    await rollupDay(makeEnv(), DAY);
    const row = await db.prepare("SELECT masked_config_json, first_seen, events FROM config_catalog").first();
    expect(row).toEqual({ masked_config_json: '{"mode":"group","schema":"<url>"}', first_seen: "2026-10-01", events: 25 });
  });

  it("gives identical rows when run twice for the same day", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    const first = {
      counts: await counts(),
      catalog: (await db.prepare("SELECT * FROM config_catalog").all()).results,
      rejects: (await db.prepare("SELECT * FROM rejects_daily").all()).results,
    };
    await rollupDay(makeEnv(), DAY);
    expect(await counts()).toEqual(first.counts);
    expect((await db.prepare("SELECT * FROM config_catalog").all()).results).toEqual(first.catalog);
    expect((await db.prepare("SELECT * FROM rejects_daily").all()).results).toEqual(first.rejects);
  });

  it("records per-day catalog counts per shape and ci, idempotently", async () => {
    mockAe({
      catalog: [
        { fp_shape: "s1", ci: "0", version: "1.0.0", config: "{}", events: 20, debounced: 6 },
        { fp_shape: "s1", ci: "0", version: "1.1.0", config: "{}", events: 10, debounced: 4 },
        { fp_shape: "s1", ci: "1", version: "1.0.0", config: "{}", events: 7, debounced: 2 },
        { fp_shape: "s2", ci: "0", version: "1.0.0", config: "{}", events: 3, debounced: 1 },
      ],
    });
    const daily = async () =>
      (
        await db
          .prepare("SELECT * FROM config_catalog_daily ORDER BY day, fp_shape, ci")
          .all()
      ).results;
    await rollupDay(makeEnv(), DAY);
    const first = await daily();
    expect(first).toEqual([
      { day: DAY, fp_shape: "s1", ci: "0", events: 30, debounced_events: 10 },
      { day: DAY, fp_shape: "s1", ci: "1", events: 7, debounced_events: 2 },
      { day: DAY, fp_shape: "s2", ci: "0", events: 3, debounced_events: 1 },
    ]);
    const catalogSql = sqls.find((q) => q.includes("AS fp_shape")) ?? "";
    expect(catalogSql).toContain("blob17 = '0'");
    await rollupDay(makeEnv(), DAY);
    expect(await daily()).toEqual(first);
  });

  it("adds the catalog across days", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    await rollupDay(makeEnv(), "2026-10-11");
    const row = await db.prepare("SELECT * FROM config_catalog").first<Record<string, unknown>>();
    expect(row).toMatchObject({ events: 60, first_seen: DAY, last_seen: "2026-10-11" });
    // An older day is never applied after a newer one.
    await rollupDay(makeEnv(), DAY);
    expect((await db.prepare("SELECT events FROM config_catalog").first<{ events: number }>())?.events).toBe(60);
  });

  it("caps rows per day", async () => {
    const many = Array.from({ length: MAX_ROWS_PER_DAY + 500 }, (_, i) => ({
      value: `v${i}`,
      raw: i + 1,
      debounced_1h: 1,
      debounced_1d: 1,
    }));
    mockAe({ blob8: many });
    await rollupDay(makeEnv(), DAY);
    const { results } = await db.prepare("SELECT n FROM daily_counts WHERE day = ?").bind(DAY).all<{ n: number }>();
    expect(results).toHaveLength(MAX_ROWS_PER_DAY);
    expect(Math.max(...results.map((r) => r.n))).toBe(MAX_ROWS_PER_DAY + 500);
  });

  it("sends no header or IP columns to the SQL API", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    expect(sqls.length).toBeGreaterThan(0);
    for (const sql of sqls) {
      expect(sql).not.toMatch(/user.?agent|\bip\b|header|x-forwarded|cf-connecting|\bcolo\b/i);
    }
  });

  it("counts formatters on config events only", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    const formatter = sqls.filter((sql) => /SELECT blob6 AS value/.test(sql));
    expect(formatter).toHaveLength(2);
    for (const sql of formatter) {
      expect(sql).toContain("blob1 = 'config'");
    }
  });

  it("never puts a tuple in count(DISTINCT ...), which the AE SQL API rejects", async () => {
    mockAe(base);
    await rollupDay(makeEnv(), DAY);
    for (const sql of sqls) {
      expect(sql).not.toMatch(/count\(DISTINCT \(/i);
    }
  });

  it("throws when the SQL API fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(rollupDay(makeEnv(), DAY)).rejects.toThrow("500");
  });
});

describe("generate rollup", () => {
  const generateFixtures: Fixtures = {
    generate: [
      {
        version: "1.0.0", trigger: "cli", ci: "1", runs: 40, failures: 4,
        pages_p50: 10, pages_p95: 90, duration_p50: 1200, duration_p95: 8000,
      },
    ],
    generate_errors: [{ version: "1.0.0", error_type: "post:TypeError", runs: 4 }],
  };

  it("queries clean generate events with weighted quantiles", async () => {
    mockAe(generateFixtures);
    await rollupDay(makeEnv(), DAY);
    const sql = sqls.find((q) => q.includes("AS pages_p50")) ?? "";
    expect(sql).toContain("blob1 = 'generate'");
    expect(sql).toContain("blob17 = '0'");
    // The AE SQL API rejects a Float64 weight in the weighted quantiles.
    expect(sql).toContain("quantileExactWeighted(0.95)(double3, toUInt32(_sample_interval * double1))");
    expect(sql).toContain("quantileExactWeighted(0.5)(double2, toUInt32(_sample_interval * double1))");
    expect(sql).toContain("sumIf(_sample_interval * double1, blob20 != '')");
    const errors = sqls.find((q) => q.includes("AS error_type")) ?? "";
    expect(errors).toContain("blob20 != ''");
    expect(errors).toContain("blob17 = '0'");
  });

  it("fills the generate tables idempotently", async () => {
    mockAe(generateFixtures);
    await rollupDay(makeEnv(), DAY);
    await rollupDay(makeEnv(), DAY);
    const daily = (await db.prepare("SELECT * FROM generate_daily").all()).results;
    expect(daily).toEqual([
      {
        day: DAY, pkg_version: "1.0", trigger: "cli", ci: "1", runs: 40, failures: 4,
        pages_p50: 10, pages_p95: 90, duration_p50: 1200, duration_p95: 8000,
      },
    ]);
    const errors = (await db.prepare("SELECT * FROM generate_errors_daily").all()).results;
    expect(errors).toEqual([{ day: DAY, pkg_version: "1.0", error_type: "post:TypeError", runs: 4 }]);
  });

  it("merges patch versions into one major.minor row", async () => {
    mockAe({
      blob5: [
        { value: "1.2.3", raw: 10, debounced_1h: 5, debounced_1d: 4 },
        { value: "1.2.4", raw: 20, debounced_1h: 7, debounced_1d: 6 },
      ],
      catalog: [
        { fp_shape: "s1", version: "1.2.3", config: "{}", events: 20, debounced: 6 },
        { fp_shape: "s1", version: "1.2.4", config: "{}", events: 10, debounced: 4 },
      ],
      generate: [
        {
          version: "1.2.3", trigger: "cli", ci: "1", runs: 10, failures: 1,
          pages_p50: 10, pages_p95: 100, duration_p50: 1000, duration_p95: 2000,
        },
        {
          version: "1.2.4", trigger: "cli", ci: "1", runs: 30, failures: 3,
          pages_p50: 20, pages_p95: 200, duration_p50: 2000, duration_p95: 4000,
        },
      ],
      generate_errors: [
        { version: "1.2.3", error_type: "post:TypeError", runs: 1 },
        { version: "1.2.4", error_type: "post:TypeError", runs: 3 },
      ],
    });
    await rollupDay(makeEnv(), DAY);
    const versions = (await counts()).filter((r) => r.dim === "pkgVersion" && r.measure === "raw");
    expect(versions).toEqual([{ ci: "0", dim: "pkgVersion", value: "1.2", measure: "raw", n: 30 }]);
    const daily = (await db.prepare("SELECT * FROM generate_daily").all()).results;
    expect(daily).toEqual([
      {
        day: DAY, pkg_version: "1.2", trigger: "cli", ci: "1", runs: 40, failures: 4,
        pages_p50: 17.5, pages_p95: 175, duration_p50: 1750, duration_p95: 3500,
      },
    ]);
    const errors = (await db.prepare("SELECT * FROM generate_errors_daily").all()).results;
    expect(errors).toEqual([{ day: DAY, pkg_version: "1.2", error_type: "post:TypeError", runs: 4 }]);
    const catalog = await db.prepare("SELECT versions_seen FROM config_catalog").first();
    expect(catalog).toEqual({ versions_seen: "1.2" });
  });
});

describe("scheduled", () => {
  it("rolls up the previous UTC day", async () => {
    mockAe(base);
    await worker.scheduled(
      { scheduledTime: Date.parse("2026-10-11T02:00:00Z"), cron: "0 2 * * *" } as ScheduledController,
      makeEnv(),
    );
    expect((await counts(DAY)).length).toBeGreaterThan(0);
    expect(sqls[0]).toContain(`'${DAY} 00:00:00'`);
  });
});

describe("alert", () => {
  const run = (webhook: string | undefined) =>
    worker.scheduled(
      { scheduledTime: Date.parse("2026-10-11T02:00:00Z"), cron: "0 2 * * *" } as ScheduledController,
      makeEnv({ ALERT_WEBHOOK: webhook }),
    );
  const hookCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).startsWith("https://hooks.test"));

  it("fires on zero config events", async () => {
    mockAe({ blob1: [{ value: "create", raw: 2, debounced_1h: 1, debounced_1d: 1 }] });
    await run("https://hooks.test/x");
    const calls = hookCalls();
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String((calls[0][1] as RequestInit).body));
    expect(body.content).toContain("2026-10-10");
    expect(body.text).toBe(body.content);
  });

  it("stays silent when only colo-sampled config events arrived", async () => {
    mockAe({
      blob1: [{ value: "create", raw: 2, debounced_1h: 1, debounced_1d: 1 }],
      "colo:blob1": [{ value: "config", colo_sampled: 4 }],
    });
    await run("https://hooks.test/x");
    expect(hookCalls()).toHaveLength(0);
  });

  it("stays silent when config events arrived", async () => {
    mockAe(base);
    await run("https://hooks.test/x");
    expect(hookCalls()).toHaveLength(0);
  });

  it("does nothing without a webhook", async () => {
    mockAe({});
    await run(undefined);
    expect(hookCalls()).toHaveLength(0);
  });

  it("fires and rethrows when the rollup fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/analytics_engine/sql")) return new Response(null, { status: 422 });
      return new Response(null, { status: 204 });
    });
    await expect(run("https://hooks.test/x")).rejects.toThrow("422");
    const calls = hookCalls();
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String((calls[0][1] as RequestInit).body));
    expect(body.content).toBe("gqlmd telemetry: rollup of 2026-10-10 (UTC) failed");
  });

  it("survives a failing webhook", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://hooks.test")) throw new Error("down");
      return Response.json({ data: [] });
    });
    await expect(run("https://hooks.test/x")).resolves.toBeUndefined();
  });
});
