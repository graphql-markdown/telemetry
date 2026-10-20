import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const wf = readFileSync(resolve(root, ".github/workflows/public-stats.yml"), "utf8");
const lock = readFileSync(resolve(root, ".github/workflows/actions.lock"), "utf8");

// Split into top-level section text (lines before "jobs:") and the rest.
const jobsIdx = wf.search(/^jobs:/m);
const top = wf.slice(0, jobsIdx);
const jobs = wf.slice(jobsIdx);

describe("public-stats workflow", () => {
  it("has schedule cron and workflow_dispatch", () => {
    expect(wf).toMatch(/^\s*schedule:\s*\n\s*- cron: /m);
    expect(wf).toMatch(/^\s*workflow_dispatch:/m);
  });

  it("is restricted to main", () => {
    expect(wf).toContain("if: github.ref == 'refs/heads/main'");
  });

  it("has read-only top-level and write-only job-level permissions", () => {
    expect(top).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(top).not.toMatch(/contents: write/);
    expect(jobs).toMatch(/^ {4}permissions:\n {6}contents: write\n(?! {6}\S)/m);
    expect(wf.match(/contents: write/g)).toHaveLength(1);
  });

  it("uses only actions present in actions.lock", () => {
    const refs = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(lock).toContain(`'${r}'`);
  });

  it("keeps Cloudflare secrets in step-level env only", () => {
    expect(top).not.toMatch(/CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)/);
    // Job-level section: between "    steps:" start and everything before it.
    const jobHeader = jobs.slice(0, jobs.indexOf("    steps:"));
    expect(jobHeader).not.toMatch(/secrets\./);
    expect(jobHeader).not.toMatch(/CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)/);
    const lines = wf.split("\n");
    const secretLines = lines.filter((l) => /secrets\.CLOUDFLARE_/.test(l));
    expect(secretLines.length).toBe(2);
    for (const l of secretLines) expect(l).toMatch(/^ {10}CLOUDFLARE_/);
  });
});
