import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../backfill.sh");

const dryRun = (...args: string[]) => spawnSync(SCRIPT, ["--dry-run", ...args], { encoding: "utf8" });

describe("backfill.sh", () => {
  it("queues every day of the range, inclusive", () => {
    const res = dryRun("2026-02-27", "2026-03-01");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(
      "INSERT OR IGNORE INTO rollup_backfill (day) VALUES ('2026-02-27'),('2026-02-28'),('2026-03-01')",
    );
  });

  it("queues a single day when TO is omitted", () => {
    const res = dryRun("2026-10-12");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("INSERT OR IGNORE INTO rollup_backfill (day) VALUES ('2026-10-12')");
  });

  it.each([
    ["an invalid day", ["2026-02-30"]],
    ["a malformed day", ["2026-1-01"]],
    ["SQL in the day", ["2026-10-12'); DROP TABLE daily_counts; --"]],
    ["TO before FROM", ["2026-10-14", "2026-10-12"]],
    ["a range over 90 days", ["2026-01-01", "2026-04-01"]],
    ["no day", []],
  ])("rejects %s", (_, args) => {
    const res = dryRun(...args);
    expect(res.status).toBe(2);
    expect(res.stdout).toBe("");
  });
});
