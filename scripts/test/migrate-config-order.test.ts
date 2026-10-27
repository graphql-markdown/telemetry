import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../../worker/src/fingerprint";

const SCRIPT = resolve(__dirname, "../migrate-config-order.sh");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "migrate-config-order-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(rows: Array<{ fp_shape: string; masked_config_json: string }>, args: string[] = []) {
  const fixture = join(dir, "d1.json");
  writeFileSync(fixture, JSON.stringify([{ results: rows, success: true }]));
  const res = spawnSync(SCRIPT, args, {
    env: { ...process.env, D1_JSON_FILE: fixture },
    encoding: "utf8",
  });
  const plan = res.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; old: string; new: string });
  return { res, plan };
}

describe("migrate-config-order.sh", () => {
  it("plans the same canonical JSON as the Worker", () => {
    const configs = [
      { schema: "<url>", docOptions: { index: true, frontMatter: false } },
      { loaders: { UrlLoader: { module: "<pkg>", options: { z: 1, a: [{ y: true, b: "x" }] } } }, baseURL: "/" },
      { msg: 'it\'s "quoted" é', a: 1.5, list: ["b", "a"] },
    ];
    const rows = configs.map((config, i) => ({ fp_shape: `s${i}`, masked_config_json: JSON.stringify(config) }));
    const { res, plan } = run(rows);
    expect(res.status).toBe(0);
    expect(plan).toEqual(
      rows.map((row, i) => ({ id: row.fp_shape, old: row.masked_config_json, new: canonicalJson(configs[i]) })),
    );
  });

  it("skips sorted and invalid rows", () => {
    const { res, plan } = run([
      { fp_shape: "sorted", masked_config_json: '{"formatter":"x","schema":"<url>"}' },
      { fp_shape: "truncated", masked_config_json: '{"truncated":true}' },
      { fp_shape: "broken", masked_config_json: "not json" },
    ]);
    expect(res.status).toBe(0);
    expect(plan).toEqual([]);
    expect(res.stderr).toContain("3 rows, 0 to rewrite, 1 not valid JSON");
  });

  it("refuses --apply on a saved result", () => {
    const { res } = run([], ["--apply"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--apply cannot be used with D1_JSON_FILE");
  });

  it("rejects unknown arguments", () => {
    expect(run([], ["--yes"]).res.status).toBe(2);
  });
});

const FAKE_CURL = resolve(__dirname, "fake-curl.sh");
const hasSqlite = spawnSync("sqlite3", ["-version"]).status === 0;

describe("migrate-config-order.sh --apply", () => {
  type Row = { fp_shape: string; masked_config_json: string };

  function apply(rows: Row[], db?: string) {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    copyFileSync(FAKE_CURL, join(bin, "curl"));
    chmodSync(join(bin, "curl"), 0o755);
    const fixture = join(dir, "d1.json");
    writeFileSync(fixture, JSON.stringify([{ results: rows, success: true }]));
    const log = join(dir, "updates.log");
    writeFileSync(log, "");
    const { D1_JSON_FILE: _ignored, ...env } = process.env;
    const res = spawnSync(SCRIPT, ["--apply"], {
      env: {
        ...env,
        PATH: `${bin}:${process.env.PATH}`,
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_ACCOUNT_ID: "acct",
        FAKE_D1_JSON: fixture,
        FAKE_LOG: log,
        ...(db ? { FAKE_DB: db } : {}),
      },
      encoding: "utf8",
    });
    const bodies = readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { sql: string; params: string[] });
    return { res, bodies };
  }

  const unsorted: Row[] = [
    { fp_shape: "a", masked_config_json: '{"schema":"<url>","docOptions":{"index":true,"frontMatter":false}}' },
    { fp_shape: "b", masked_config_json: '{"msg":"it\'s \\"q\\" é","a":1}' },
    { fp_shape: "c", masked_config_json: '{"formatter":"x","schema":"<url>"}' },
  ];

  it("binds each chunk as a JSON array of {id, old, new}", () => {
    const { res, bodies } = apply(unsorted);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toContain("bookmark before the update: bm-1");
    expect(res.stderr).toContain("rewrote 2 of 2 rows");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].sql).toMatch(/^UPDATE config_catalog/);
    expect(JSON.parse(bodies[0].params[0])).toEqual([
      {
        id: "a",
        old: unsorted[0].masked_config_json,
        new: canonicalJson(JSON.parse(unsorted[0].masked_config_json)),
      },
      {
        id: "b",
        old: unsorted[1].masked_config_json,
        new: canonicalJson(JSON.parse(unsorted[1].masked_config_json)),
      },
    ]);
  });

  it.skipIf(!hasSqlite)("rewrites the rows in SQLite and skips rows changed since the read", () => {
    const db = join(dir, "d1.sqlite");
    const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
    // Row "b" was rewritten by the rollup after the read: its stored value no longer matches "old".
    const stored = [unsorted[0], { fp_shape: "b", masked_config_json: '{"a":1,"msg":"other"}' }, unsorted[2]];
    const setup = spawnSync("sqlite3", [db], {
      input:
        "CREATE TABLE config_catalog (fp_shape TEXT PRIMARY KEY, masked_config_json TEXT NOT NULL);\n" +
        stored.map((r) => `INSERT INTO config_catalog VALUES (${quote(r.fp_shape)}, ${quote(r.masked_config_json)});`).join("\n"),
      encoding: "utf8",
    });
    expect(setup.status, setup.stderr).toBe(0);

    const { res } = apply(unsorted, db);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("rewrote 1 of 2 rows");
    expect(res.stderr).toContain("1 rows not rewritten");

    const dump = spawnSync("sqlite3", ["-json", db, "SELECT fp_shape, masked_config_json FROM config_catalog ORDER BY fp_shape"], {
      encoding: "utf8",
    });
    expect(JSON.parse(dump.stdout)).toEqual([
      { fp_shape: "a", masked_config_json: '{"docOptions":{"frontMatter":false,"index":true},"schema":"<url>"}' },
      { fp_shape: "b", masked_config_json: '{"a":1,"msg":"other"}' },
      { fp_shape: "c", masked_config_json: '{"formatter":"x","schema":"<url>"}' },
    ]);
  });
});
