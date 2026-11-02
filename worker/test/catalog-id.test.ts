import { describe, expect, it } from "vitest";

import { canonicalJson, fingerprints, formatterOf } from "../src/fingerprint";
import { catalogId } from "../src/rollup";
import { validate } from "../src/schema";

const base = {
  v: 1,
  event: "config",
  pkg: "@graphql-markdown/cli",
  pkgVersion: "1.2",
  nodeMajor: 24,
  graphqlMajor: 16,
  os: "darwin",
  ci: false,
  pm: "npm",
  firstRun: false,
  trigger: "cli",
  container: false,
  wsl: false,
};

describe("catalogId", () => {
  it.each([
    [{ schema: "<url>", formatter: "@graphql-markdown/docusaurus" }, "url"],
    [{ schema: ["<glob>", "<glob>"], metatags: [{ "<key:0>": "<string>" }] }, ["glob", "glob"]],
    [{ schema: ["<url>", "<glob>"] }, ["url", "glob"]],
  ])("matches the ingest fpShape of %j", async (config, loader) => {
    const result = validate({ ...base, config, loader });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const { value } = result;
    const stored = Array.isArray(value.loader) ? value.loader.join(",") : String(value.loader);
    const id = await catalogId(canonicalJson(value.config), stored, formatterOf(value));
    expect(id).toBe((await fingerprints(value)).fpShape);
  });

  it("gives one id for a loader blob with repeated kinds", async () => {
    const config = '{"schema":"<glob>"}';
    expect(await catalogId(config, "glob,glob,glob", "")).toBe(await catalogId(config, "glob", ""));
  });

  it("keeps configs with another loader or formatter apart", async () => {
    const config = '{"schema":"<glob>"}';
    const id = await catalogId(config, "glob", "");
    expect(await catalogId(config, "url", "")).not.toBe(id);
    expect(await catalogId(config, "glob", "mdx")).not.toBe(id);
  });

  it("accepts a config that is not JSON", async () => {
    expect(await catalogId("not json", "", "")).toMatch(/^[0-9a-f]{64}$/);
  });
});
