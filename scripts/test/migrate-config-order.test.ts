import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
