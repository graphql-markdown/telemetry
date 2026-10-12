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
