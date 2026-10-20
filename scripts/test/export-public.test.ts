import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../export-public.sh");
const APP_JS = resolve(__dirname, "../../dashboard/app.js");
const SETTING_KEYS = ["diffMethod", "force", "hierarchy", "mdxParser", "pretty", "telemetry"];
const PANELS = ["versions", "ci", "provider", "formatter", "graphql", "loader", "create", "targets"];
const EMPTY = { series: [], totals: [], suppressed_count: 0 };

type Row = { day: string; ci: string; dim: string; measure: string; value: string; n: number };

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
const row = (dim: string, value: string, n: number, o: Partial<Row> = {}): Row => ({
  day: "2026-01-01",
  ci: "0",
  measure: "raw",
  dim,
  value,
  n,
  ...o,
});

describe("export-public.sh", () => {
  it("suppresses by range total, not the daily value", () => {
    const { json } = runRows([
      row("formatter", "v", 3, { day: "2026-01-01" }),
      row("formatter", "v", 3, { day: "2026-01-02" }),
    ]);
    expect(json.panels.formatter.totals).toEqual([{ value: "v", n: 6 }]);
    expect(json.panels.formatter.series).toEqual([
      { day: "2026-01-01", value: "v", n: 3 },
      { day: "2026-01-02", value: "v", n: 3 },
    ]);
    expect(json.panels.formatter.suppressed_count).toBe(0);
  });

  it("keeps n=5, hides n=4 and counts it", () => {
    const { json } = runRows([row("formatter", "keep", 5), row("formatter", "hide", 4)]);
    expect(json.panels.formatter.totals).toEqual([{ value: "keep", n: 5 }]);
    expect(json.panels.formatter.suppressed_count).toBe(1);
  });

  it("removes suppressed values from the series", () => {
    const { json } = runRows([row("formatter", "keep", 9), row("formatter", "hide", 2)]);
    expect(json.panels.formatter.series.map((s: Row) => s.value)).toEqual(["keep"]);
    expect(JSON.stringify(json.panels.formatter)).not.toContain("hide");
  });

  it("local panels ignore ci=1, provider ignores ci=0, ci panel has both", () => {
    const { json } = runRows([
      row("formatter", "loc", 10, { ci: "0" }),
      row("formatter", "ci", 10, { ci: "1" }),
      row("ciProvider", "gha", 10, { ci: "1" }),
      row("ciProvider", "nope", 10, { ci: "0" }),
      row("ci", "0", 7, { ci: "0" }),
      row("ci", "1", 8, { ci: "1" }),
    ]);
    expect(json.panels.formatter.totals).toEqual([{ value: "loc", n: 10 }]);
    expect(json.panels.provider.totals).toEqual([{ value: "gha", n: 10 }]);
    expect(json.panels.ci.totals).toEqual([
      { value: "1", n: 8 },
      { value: "0", n: 7 },
    ]);
  });

  it("separates raw and debounced_1d event kpis", () => {
    const { json } = runRows([
      row("event", "run", 11, { measure: "raw" }),
      row("event", "run", 6, { measure: "debounced_1d" }),
    ]);
    expect(json.kpis.events.totals).toEqual([{ value: "run", n: 11 }]);
    expect(json.kpis.configs.totals).toEqual([{ value: "run", n: 6 }]);
    expect(json.kpis.debounced).toEqual(json.kpis.configs);
  });

  it("create panel only has create_scaffold and create_wire", () => {
    const { json } = runRows([
      row("event", "create_scaffold", 6),
      row("event", "create_wire", 7),
      row("event", "run", 50),
    ]);
    expect(json.panels.create.totals).toEqual([
      { value: "create_wire", n: 7 },
      { value: "create_scaffold", n: 6 },
    ]);
    expect(JSON.stringify(json.panels.create)).not.toContain("run");
    expect(json.panels.create.suppressed_count).toBe(0);
  });

  it("settings has all six keys in order, empty when absent", () => {
    const { json } = runRows([row("setting.force", "true", 9)]);
    expect(json.settings.map((s: { key: string }) => s.key)).toEqual(SETTING_KEYS);
    for (const s of json.settings) {
      if (s.key === "force") expect(s.totals).toEqual([{ value: "true", n: 9 }]);
      else expect(s).toEqual({ key: s.key, totals: [], suppressed_count: 0 });
      expect(s.series).toBeUndefined();
    }
  });

  it("sorts totals by n descending and series by day then value", () => {
    const { json } = runRows([
      row("pkgVersion", "a", 7, { day: "2026-01-02" }),
      row("pkgVersion", "b", 100, { day: "2026-01-02" }),
      row("pkgVersion", "c", 20, { day: "2026-01-01" }),
      row("pkgVersion", "b", 1, { day: "2026-01-01" }),
    ]);
    expect(json.panels.versions.totals.map((t: Row) => t.value)).toEqual(["b", "c", "a"]);
    expect(json.panels.versions.series.map((s: Row) => `${s.day}/${s.value}`)).toEqual([
      "2026-01-01/b",
      "2026-01-01/c",
      "2026-01-02/a",
      "2026-01-02/b",
    ]);
  });

  it("empty results yields the full structure and exit 0", () => {
    const { res, json } = runRows([]);
    expect(res.status).toBe(0);
    expect(Object.keys(json.kpis)).toEqual(["events", "configs", "debounced"]);
    for (const k of Object.keys(json.kpis)) expect(json.kpis[k]).toEqual(EMPTY);
    expect(Object.keys(json.panels)).toEqual(PANELS);
    for (const p of PANELS) expect(json.panels[p]).toEqual(EMPTY);
    expect(json.settings).toHaveLength(6);
  });

  it("fails on malformed input and leaves no output file", () => {
    const { res, out } = run("this is not json");
    expect(res.status).not.toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it("emits version 2, min_count, 90-day range and ISO generated", () => {
    const { json } = runRows([]);
    expect(json.version).toBe(2);
    expect(json.min_count).toBe(5);
    expect(json.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.generated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((Date.parse(json.to) - Date.parse(json.from)) / 86400000).toBe(89);
  });

  it("preserves fractional n as given", () => {
    const { json } = runRows([row("formatter", "f", 12.5)]);
    expect(json.panels.formatter.totals).toEqual([{ value: "f", n: 12.5 }]);
    expect(json.panels.formatter.series[0].n).toBe(12.5);
  });

  it("drift: dashboard SETTINGS match the output and the SQL", () => {
    const app = readFileSync(APP_JS, "utf8");
    const m = /var SETTINGS = \[([^\]]*)\]/.exec(app);
    expect(m).not.toBeNull();
    const keys = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const { json } = runRows([]);
    expect(json.settings.map((s: { key: string }) => s.key)).toEqual(keys);
    const sh = readFileSync(SCRIPT, "utf8");
    const sqlKeys = [...sh.matchAll(/'setting\.([^']+)'/g)].map((x) => x[1]);
    expect(sqlKeys).toEqual(keys);
  });
});


describe("export-public.sh against the D1 API", () => {
  // Stub curl: logs each call, answers the database lookup and the query from fixtures,
  // or fails like `curl --fail-with-body` with the API's error body.
  const stubCurl = (opts: { fail?: boolean } = {}) => {
    const bin = join(dir, "bin");
    const log = join(dir, "curl.log");
    mkdirSync(bin);
    const lookup = JSON.stringify({ result: [{ name: "other", uuid: "wrong" }, { name: "gqlmd-telemetry", uuid: "db-123" }] });
    const query = JSON.stringify({
      result: [{ results: [{ day: "2026-01-01", ci: "0", measure: "raw", dim: "formatter", value: "a", n: 9 }, { day: "2026-01-01", ci: "0", measure: "raw", dim: "formatter", value: "b", n: 2 }], success: true }],
    });
    const body = opts.fail
      ? `printf '%s' '{"errors":[{"code":10000,"message":"Authentication error"}]}'; exit 22`
      : `case "$*" in *"/db-123/query"*) printf '%s' '${query}' ;; *) printf '%s' '${lookup}' ;; esac`;
    writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\necho "$*" >> "${log}"\n${body}\n`, { mode: 0o755 });
    return { bin, log };
  };

  const runApi = (bin: string) => {
    const out = join(dir, "stats.json");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acct" };
    delete env.D1_JSON_FILE;
    const res = spawnSync(SCRIPT, [out], { env, encoding: "utf8" });
    return { res, out };
  };

  it("looks the database up by name, then queries it by id", () => {
    const { bin, log } = stubCurl();
    const { res, out } = runApi(bin);
    expect(res.status).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/accounts/acct/d1/database?name=gqlmd-telemetry");
    expect(calls[1]).toContain("/accounts/acct/d1/database/db-123/query");
    expect(calls[1]).toContain("daily_counts");
    const json = JSON.parse(readFileSync(out, "utf8"));
    expect(json.panels.formatter.totals).toEqual([{ value: "a", n: 9 }]);
    expect(json.panels.formatter.suppressed_count).toBe(1);
  });

  it("prints the API error body and writes no output on failure", () => {
    const { bin } = stubCurl({ fail: true });
    const { res, out } = runApi(bin);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("Authentication error");
    expect(res.stderr).not.toContain("tok");
    expect(existsSync(out)).toBe(false);
  });
});
