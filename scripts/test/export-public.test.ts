import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../export-public.sh");
const DIMS = ["formatter", "graphqlMajor", "loader.kind", "pkgVersion"];

type Row = { dim: string; value: string; n: number };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "export-public-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(input: string) {
  const fixture = join(dir, "d1.json");
  const out = join(dir, "stats.json");
  writeFileSync(fixture, input);
  const res = spawnSync(SCRIPT, [out], {
    env: { ...process.env, D1_JSON_FILE: fixture },
    encoding: "utf8",
  });
  return { res, out, json: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null };
}

const runRows = (rows: Row[]) => run(JSON.stringify([{ results: rows, success: true }]));

describe("export-public.sh", () => {
  it("keeps n=5 and hides n=4, counting suppressed", () => {
    const { json } = runRows([
      { dim: "formatter", value: "keep", n: 5 },
      { dim: "formatter", value: "hide", n: 4 },
    ]);
    expect(json.dims.formatter.totals).toEqual([{ value: "keep", n: 5 }]);
    expect(json.dims.formatter.suppressed_count).toBe(1);
  });

  it("sorts totals by n descending", () => {
    const { json } = runRows([
      { dim: "pkgVersion", value: "a", n: 7 },
      { dim: "pkgVersion", value: "b", n: 100 },
      { dim: "pkgVersion", value: "c", n: 20 },
    ]);
    expect(json.dims.pkgVersion.totals.map((t: Row) => t.value)).toEqual(["b", "c", "a"]);
  });

  it("always has all four dims, empty when no rows", () => {
    const { json } = runRows([{ dim: "formatter", value: "x", n: 9 }]);
    expect(Object.keys(json.dims).sort()).toEqual([...DIMS].sort());
    for (const d of DIMS.filter((d) => d !== "formatter")) {
      expect(json.dims[d]).toEqual({ totals: [], suppressed_count: 0 });
    }
  });

  it("ignores dims outside the list", () => {
    const { json } = runRows([
      { dim: "secret", value: "x", n: 50 },
      { dim: "formatter", value: "y", n: 50 },
    ]);
    expect(Object.keys(json.dims).sort()).toEqual([...DIMS].sort());
    expect(JSON.stringify(json)).not.toContain("secret");
  });

  it("emits min_count, 90-day range and ISO generated", () => {
    const { json } = runRows([]);
    expect(json.min_count).toBe(5);
    expect(json.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.generated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const days = (Date.parse(json.to) - Date.parse(json.from)) / 86400000;
    expect(days).toBe(89);
  });

  it("empty results yields four empty dims and exit 0", () => {
    const { res, json } = runRows([]);
    expect(res.status).toBe(0);
    for (const d of DIMS) expect(json.dims[d]).toEqual({ totals: [], suppressed_count: 0 });
  });

  it("fails on malformed input and leaves no output file", () => {
    const { res, out } = run("this is not json");
    expect(res.status).not.toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it("preserves fractional n as given", () => {
    const { json } = runRows([{ dim: "formatter", value: "f", n: 12.5 }]);
    expect(json.dims.formatter.totals).toEqual([{ value: "f", n: 12.5 }]);
  });
});
