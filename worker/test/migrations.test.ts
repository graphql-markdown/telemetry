import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { applyMigrations } from "./helpers";

describe("migrations", () => {
  it("creates the rollup tables", async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await applyMigrations(db);
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>();
    const names = results.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining(["config_catalog", "daily_counts", "rejects_daily", "generate_daily", "generate_errors_daily"]),
    );
  });

  it("is idempotent", async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await applyMigrations(db);
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });
});

describe("migration 0005 truncate pkgVersion", () => {
  const read = async (db: D1Database) => {
    const q = async (sql: string) => (await db.prepare(sql).all<Record<string, unknown>>()).results;
    return {
      dc: await q("SELECT value, n FROM daily_counts WHERE dim = 'pkgVersion' ORDER BY value"),
      gd: await q("SELECT pkg_version, runs, failures, pages_p50, duration_p95 FROM generate_daily ORDER BY pkg_version"),
      ge: await q("SELECT pkg_version, runs FROM generate_errors_daily ORDER BY pkg_version"),
      cc: await q("SELECT versions_seen FROM config_catalog ORDER BY rowid"),
    };
  };

  it("merges truncated versions and is idempotent", async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await applyMigrations(db, 4);
    const dcRow = (v: string, n: number) =>
      db
        .prepare("INSERT INTO daily_counts (day, ci, dim, value, measure, n) VALUES ('2026-01-01','0','pkgVersion',?,'events',?)")
        .bind(v, n);
    const gdRow = (v: string, runs: number, p50: number) =>
      db
        .prepare(
          "INSERT INTO generate_daily (day, pkg_version, trigger, ci, runs, failures, pages_p50, pages_p95, duration_p50, duration_p95) VALUES ('2026-01-01',?,'cli','0',?,1,?,?,?,?)",
        )
        .bind(v, runs, p50, p50, p50, p50);
    await db.batch([
      dcRow("1.2.3", 2),
      dcRow("1.2.4", 3),
      dcRow("1.3.0-rc.1", 1),
      dcRow("1.3.0-rc.2", 4),
      dcRow("unknown-value", 5),
      gdRow("1.2.3", 1, 10),
      gdRow("1.2.4", 3, 20),
      gdRow("1.3.0-rc.1", 2, 5),
      gdRow("unknown-value", 0, 7),
      db.prepare("INSERT INTO generate_errors_daily (day, pkg_version, error_type, runs) VALUES ('2026-01-01','1.2.3','E',2)"),
      db.prepare("INSERT INTO generate_errors_daily (day, pkg_version, error_type, runs) VALUES ('2026-01-01','1.2.4','E',5)"),
      db.prepare(
        "INSERT INTO config_catalog (fp_shape, masked_config_json, versions_seen, first_seen, last_seen, events, debounced_events, last_rolled_day) VALUES ('a','{}','1.0.0,1.1.0,1.1.2','2026-01-01','2026-01-01',1,1,'2026-01-01')",
      ),
    ]);
    await applyMigrations(db, 5, 5);
    const first = await read(db);
    expect(first.dc).toEqual([
      { value: "1.2", n: 5 },
      { value: "1.3", n: 5 },
      { value: "unknown-value", n: 5 },
    ]);
    expect(first.gd).toEqual([
      { pkg_version: "1.2", runs: 4, failures: 2, pages_p50: 17.5, duration_p95: 17.5 },
      { pkg_version: "1.3", runs: 2, failures: 1, pages_p50: 5, duration_p95: 5 },
      { pkg_version: "unknown-value", runs: 0, failures: 1, pages_p50: 7, duration_p95: 7 },
    ]);
    expect(first.ge).toEqual([{ pkg_version: "1.2", runs: 7 }]);
    expect(first.cc).toEqual([{ versions_seen: "1.0,1.1" }]);
    await applyMigrations(db, 5, 5);
    expect(await read(db)).toEqual(first);
  });
});
