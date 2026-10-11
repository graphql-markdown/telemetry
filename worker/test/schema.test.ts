import { describe, expect, it } from "vitest";

import { validate } from "../src/schema";

const base = () => ({
  v: 1,
  event: "config",
  pkg: "@graphql-markdown/cli",
  pkgVersion: "0.1.0",
  nodeMajor: 24,
  graphqlMajor: 16,
  os: "darwin",
  ci: false,
  pm: "unknown",
  firstRun: false,
  trigger: "cli",
  container: false,
  wsl: false,
});

const README_PAYLOAD = {
  ...base(),
  config: {
    schema: "<url>",
    rootPath: "<path>",
    baseURL: "<url>",
    linkRoot: "<path>",
    homepage: "<path>",
    formatter: "@graphql-markdown/docusaurus",
    skipDocDirective: ["<string>"],
    groupByDirective: {
      directive: "<string>",
      field: "<string>",
      fallback: "<string>",
    },
    printTypeOptions: { deprecated: "group", typeBadges: true },
    metatags: [{ "<key:0>": "<string>", "<key:1>": "<string>" }],
    loaders: { UrlLoader: "@graphql-tools/url-loader" },
  },
  loader: "url",
  cli: { force: true },
};

const withConfig = (config: unknown) => ({ ...base(), config });

describe("validate: accepted payloads", () => {
  it("accepts the README example unchanged", () => {
    const result = validate(README_PAYLOAD);
    expect(result).toEqual({ ok: true, value: README_PAYLOAD });
  });

  it("accepts a minimal envelope", () => {
    expect(validate(base())).toEqual({ ok: true, value: base() });
  });

  it("accepts create events with target and mode", () => {
    const payload = {
      ...base(),
      event: "create_scaffold",
      trigger: "create",
      target: "docusaurus",
      mode: "scaffold",
      ciProvider: "github-actions",
      ci: true,
    };
    expect(validate(payload)).toEqual({ ok: true, value: payload });
  });

  it("accepts graphqlMajor unknown and prerelease versions", () => {
    const payload = { ...base(), graphqlMajor: "unknown", pkgVersion: "1.2.3-rc.1" };
    expect(validate(payload).ok).toBe(true);
  });

  it("accepts numbers and booleans inside config", () => {
    expect(validate(withConfig({ force: false, printTypeOptions: { parentTypePrefix: true } })).ok).toBe(true);
  });
});

describe("validate: normalization", () => {
  it("replaces unknown enum values with unknown-value", () => {
    const result = validate({
      ...base(),
      trigger: "something-new",
      pm: "deno",
      os: "plan9",
      ciProvider: "acme-ci",
      target: "my-private-preset",
      loader: ["url", "weird"],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        trigger: "unknown-value",
        pm: "unknown-value",
        os: "unknown-value",
        ciProvider: "unknown-value",
        target: "unknown-value",
        loader: ["url", "unknown-value"],
      },
    });
  });

  it("replaces an unknown pkg with unknown-value", () => {
    const result = validate({ ...base(), pkg: "acme-internal-tool" });
    expect(result).toMatchObject({ ok: true, value: { pkg: "unknown-value" } });
  });

  it("drops unknown top-level keys", () => {
    const result = validate({ ...base(), userId: "abc", ip: "1.2.3.4" });
    expect(result).toEqual({ ok: true, value: base() });
  });
});

describe("validate: failures", () => {
  it("rejects non-objects", () => {
    for (const input of [null, undefined, 1, "x", [], true]) {
      expect(validate(input)).toEqual({ ok: false, reason: "schema" });
    }
  });

  it("rejects an unknown or missing version with schema-version", () => {
    expect(validate({ ...base(), v: 2 })).toEqual({
      ok: false,
      reason: "schema-version",
    });
    expect(validate({ ...base(), v: "1" })).toEqual({
      ok: false,
      reason: "schema-version",
    });
    const { v: _v, ...rest } = base();
    expect(validate(rest)).toEqual({ ok: false, reason: "schema-version" });
  });

  it.each([
    ["missing event", { event: undefined }],
    ["non-string trigger", { trigger: 3 }],
    ["non-boolean ci", { ci: "false" }],
    ["non-boolean wsl", { wsl: 0 }],
    ["negative unknownKeys", { unknownKeys: -1 }],
    ["non-string loader", { loader: 4 }],
  ])("rejects %s", (_name, patch) => {
    expect(validate({ ...base(), ...patch })).toEqual({
      ok: false,
      reason: "schema",
    });
  });

  it("rejects non-object config and cli", () => {
    expect(validate({ ...base(), config: "<path>" }).ok).toBe(false);
    expect(validate({ ...base(), cli: ["<path>"] }).ok).toBe(false);
  });
});

describe("validate: leaking payloads", () => {
  it.each([
    ["raw path", { rootPath: "/Users/alice/project/docs" }],
    ["relative path", { rootPath: "./docs" }],
    ["url", { schema: "https://api.acme.internal/graphql" }],
    ["hostname", { host: "api.acme.internal" }],
    ["directive name", { skipDocDirective: ["@internal"] }],
    ["plain directive name", { groupByDirective: { directive: "doc" } }],
    ["nested raw string", { metatags: [{ "<key:0>": "noindex" }] }],
    ["email", { author: "alice@example.com" }],
    ["unmasked custom formatter", { formatter: "./my-formatter.js" }],
    ["third-party package", { formatter: "@acme/formatter" }],
    ["leaky key path", { "/etc/passwd": "<path>" }],
    ["leaky key url", { "https://x.test": "<url>" }],
    ["leaky key dotted", { "api.acme.internal": "<url>" }],
    ["null value", { schema: null }],
  ])("rejects %s in config", (_name, config) => {
    expect(validate(withConfig(config))).toEqual({
      ok: false,
      reason: "schema",
    });
  });

  it("rejects leaks in cli", () => {
    expect(validate({ ...base(), cli: { config: "/home/bob/x.js" } }).ok).toBe(
      false,
    );
  });

  it("rejects excessively deep config", () => {
    let nested: unknown = "<string>";
    for (let i = 0; i < 12; i++) {
      nested = { a: nested };
    }
    expect(validate(withConfig(nested)).ok).toBe(false);
  });
});

describe("validate: key allowlist", () => {
  it.each([
    ["directive-like key", { "@deprecated": "<string>" }],
    ["arbitrary key", { myCompanySecret: true }],
    ["unknown nested key", { printTypeOptions: { internalHost: true } }],
    ["cli-only key in config", { diff: "NONE" }],
    ["named key inside a map", { metatags: [{ robots: "<string>" }] }],
    ["unknown key inside groupByDirective", { groupByDirective: { x: "<string>" } }],
  ])("rejects %s in config", (_name, config) => {
    expect(validate(withConfig(config))).toEqual({ ok: false, reason: "schema" });
  });

  it("rejects an arbitrary key in cli", () => {
    expect(validate({ ...base(), cli: { myFlag: true } })).toEqual({
      ok: false,
      reason: "schema",
    });
  });

  it("accepts known option names, key tokens and loader names", () => {
    const config = {
      docOptions: { index: true, frontMatter: { "<key:0>": "<string>" } },
      loaders: { GitLoader: { module: "@graphql-tools/git-loader", options: {} } },
    };
    expect(validate(withConfig(config))).toMatchObject({ ok: true });
  });
});

describe("validate: closed sets for free-text channels", () => {
  it.each([
    ["1.2.3", "1.2.3"],
    ["1.2.3-rc.1", "1.2.3-rc.1"],
    ["1.2.3-beta.4-my-secret-branch", "1.2.3-beta.4"],
    ["1.2.3-beta-secret", "1.2.3-beta.0"],
    ["1.2.3-secretbranch.1", "unknown-value"],
    ["1.2.3+build.secret", "unknown-value"],
    ["latest", "unknown-value"],
    ["1.2.3/../x", "unknown-value"],
    ["1.2", "unknown-value"],
  ])("normalises pkgVersion %s", (input, expected) => {
    expect(validate({ ...base(), pkgVersion: input })).toMatchObject({
      ok: true,
      value: { pkgVersion: expected },
    });
  });

  it("maps unknown package names to unknown-value", () => {
    for (const pkg of ["@graphql-markdown/acme-secret", "create-graphql-markdown-docs-x"]) {
      expect(validate({ ...base(), pkg })).toMatchObject({ value: { pkg: "unknown-value" } });
    }
    expect(validate({ ...base(), pkg: "create-graphql-markdown-docs" })).toMatchObject({
      value: { pkg: "create-graphql-markdown-docs" },
    });
  });

  it("rejects unknown package names in config values", () => {
    expect(validate(withConfig({ formatter: "@graphql-markdown/acme-secret" })).ok).toBe(false);
    expect(validate(withConfig({ formatter: "@graphql-markdown/formatters/hugo" })).ok).toBe(true);
  });

  it("rejects numbers other than integers 0-1000", () => {
    for (const n of [1234567890, -1, 1.5, 1001]) {
      expect(validate(withConfig({ force: n })).ok).toBe(false);
    }
    expect(validate(withConfig({ force: 1000 })).ok).toBe(true);
  });

  it("limits key tokens, array length and object size", () => {
    expect(validate(withConfig({ metatags: [{ "<key:999>": "<string>" }] })).ok).toBe(false);
    expect(validate(withConfig({ metatags: [{ "<key:99>": "<string>" }] })).ok).toBe(true);
    expect(validate(withConfig({ skipDocDirective: Array(51).fill("<string>") })).ok).toBe(false);
    expect(validate(withConfig({ skipDocDirective: Array(50).fill("<string>") })).ok).toBe(true);
    const wide = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`<key:${i}>`, "<string>"]));
    expect(validate(withConfig({ metatags: [wide] })).ok).toBe(false);
  });

  it("maps out-of-range node and graphql majors to unknown-value", () => {
    expect(validate({ ...base(), nodeMajor: 1000, graphqlMajor: 3 })).toMatchObject({
      value: { nodeMajor: "unknown-value", graphqlMajor: "unknown-value" },
    });
    expect(validate({ ...base(), nodeMajor: 20.5, graphqlMajor: "16" })).toMatchObject({
      value: { nodeMajor: "unknown-value", graphqlMajor: "unknown-value" },
    });
  });
});
