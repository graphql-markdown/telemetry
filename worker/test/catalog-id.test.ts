import { describe, expect, it } from "vitest";

import { fingerprints } from "../src/fingerprint";
import { buildBlobs } from "../src/index";
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
    [{ config: { schema: "<url>", formatter: "@graphql-markdown/docusaurus" }, loader: "url" }],
    [{ config: { schema: ["<glob>", "<glob>"], metatags: [{ "<key:0>": "<string>" }] }, loader: ["glob", "glob"] }],
    [{ config: { schema: ["<url>", "<glob>"] }, loader: ["url", "glob"] }],
    [{ cli: { formatter: "@graphql-markdown/docusaurus" }, loader: "url" }],
    [{ loader: "url" }],
    [{ config: {} }],
    [{}],
  ])("matches the ingest fpShape of %j through the blobs", async (extra) => {
    const result = validate({ ...base, ...extra });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const { fp, fpShape } = await fingerprints(result.value);
    const blobs = buildBlobs(result.value, fp, fpShape, "0");
    expect(await catalogId(blobs[17], blobs[6], blobs[5])).toBe(fpShape);
  });

  it("gives one id to an absent and an empty config", async () => {
    const payload = validate(base);
    const empty = validate({ ...base, config: {} });
    if (!payload.ok || !empty.ok) {
      throw new Error("invalid payload");
    }
    expect((await fingerprints(empty.value)).fpShape).toBe((await fingerprints(payload.value)).fpShape);
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
