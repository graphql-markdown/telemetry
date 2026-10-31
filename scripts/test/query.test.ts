import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const QUERY = resolve(__dirname, "../query.sh");
const BACKFILL = resolve(__dirname, "../backfill.sh");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "query-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** curl stub: logs its args and request body, answers the name lookup and the query. */
const stubCurl = (opts: { fail?: boolean } = {}) => {
  const bin = join(dir, "bin");
  const log = join(dir, "curl.log");
  mkdirSync(bin);
  const lookup = JSON.stringify({ result: [{ name: "other", uuid: "wrong" }, { name: "gqlmd-telemetry", uuid: "db-123" }] });
  const query = JSON.stringify({ result: [{ results: [{ day: "2026-10-12", attempts: 0 }], success: true }] });
  const body = opts.fail
    ? `printf '%s' '{"errors":[{"code":10000,"message":"Authentication error"}]}'; exit 22`
    : `case "$*" in *"/db-123/query"*) printf '%s' '${query}' ;; *) printf '%s' '${lookup}' ;; esac`;
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\necho "$*" >> "${log}"\n${body}\n`, { mode: 0o755 });
  return { bin, log };
};

const run = (script: string, args: string[], bin: string) =>
  spawnSync(script, args, {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acct" },
    encoding: "utf8",
  });

describe("query.sh d1", () => {
  it("looks the database up by name, not the placeholder id in the wrangler config", () => {
    const { bin, log } = stubCurl();
    const res = run(QUERY, ["d1", "SELECT day, attempts FROM rollup_backfill"], bin);
    expect(res.status).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/accounts/acct/d1/database?name=gqlmd-telemetry");
    expect(calls[1]).toContain("/accounts/acct/d1/database/db-123/query");
    expect(calls[1]).toContain('{"sql":"SELECT day, attempts FROM rollup_backfill"}');
    expect(calls.join("\n")).not.toContain("00000000-0000-0000-0000-000000000000");
    expect(JSON.parse(res.stdout)).toEqual([{ results: [{ day: "2026-10-12", attempts: 0 }], success: true }]);
  });

  it("prints the API error and fails", () => {
    const { bin } = stubCurl({ fail: true });
    const res = run(QUERY, ["d1", "SELECT 1"], bin);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("Authentication error");
    expect(res.stderr).not.toContain("tok");
  });

  it("is what backfill.sh queues through", () => {
    const { bin, log } = stubCurl();
    const res = run(BACKFILL, ["2026-10-12", "2026-10-13"], bin);
    expect(res.status).toBe(0);
    expect(readFileSync(log, "utf8")).toContain(
      "INSERT OR IGNORE INTO rollup_backfill (day) VALUES ('2026-10-12'),('2026-10-13')",
    );
    expect(res.stderr).toContain("queued 2 day(s)");
  });
});
