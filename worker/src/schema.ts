/**
 * Allowlist schema, vendored from the client.
 *
 * Source: graphql-markdown/graphql-markdown, packages/telemetry/src/schema.ts
 * (payload shape: packages/telemetry/src/payload.ts).
 *
 * TODO: replace this copy with `@graphql-markdown/telemetry/schema` once that
 * subpath is published, and let Renovate keep it up to date.
 */

export const EVENTS = ["config", "create_scaffold", "create_wire"] as const;
export const TRIGGERS = [
  "cli",
  "create",
  "docusaurus-build",
  "docusaurus-dev",
  "nuxt",
  "programmatic",
] as const;
export const CI_PROVIDERS = [
  "github-actions",
  "gitlab",
  "circleci",
  "azure-pipelines",
  "jenkins",
  "bitbucket",
  "buildkite",
  "travis",
  "vercel",
  "netlify",
  "cloudflare-pages",
  "aws-codebuild",
  "teamcity",
  "appveyor",
  "drone",
  "render",
  "other",
] as const;
export const PACKAGE_MANAGERS = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "unknown",
] as const;
export const LOADER_KINDS = [
  "url",
  "file-sdl",
  "file-json",
  "git",
  "github",
  "glob",
  "code-file",
  "inline-sdl",
  "unknown",
] as const;
export const MODES = ["scaffold", "wire"] as const;
export const DIFF_METHODS = ["FORCE", "NONE"] as const;
export const DEPRECATED_OPTIONS = ["default", "group", "skip"] as const;
export const HIERARCHIES = ["api", "entity", "flat"] as const;
export const FORMATTER_PRESETS = [
  "docfx",
  "docusaurus",
  "fumadocs",
  "honkit",
  "hugo",
  "mdbook",
  "mdx",
  "mkdocs",
  "starlight",
  "vocs",
] as const;
export const KNOWN_LOADERS = [
  "UrlLoader",
  "JsonFileLoader",
  "GraphQLFileLoader",
  "CodeFileLoader",
  "GitLoader",
  "GithubLoader",
  "ApolloEngineLoader",
  "PrismaLoader",
  "@graphql-tools/url-loader",
  "@graphql-tools/json-file-loader",
  "@graphql-tools/graphql-file-loader",
  "@graphql-tools/code-file-loader",
  "@graphql-tools/git-loader",
  "@graphql-tools/github-loader",
  "@graphql-tools/apollo-engine-loader",
  "@graphql-tools/prisma-loader",
] as const;
export const MASK_TOKENS = [
  "<url>",
  "<path>",
  "<string>",
  "<function>",
  "<object>",
  "<custom-loader>",
  "<custom-formatter>",
  "<git>",
  "<github>",
  "<file:sdl>",
  "<file:json>",
  "<file:code>",
  "<glob>",
  "<inline-sdl>",
  "<unknown>",
] as const;
/** Pattern of masked object keys, e.g. `<key:0>`. */
export const KEY_TOKEN_PATTERN = "^<key:\\d+>$";

export const ALLOWLIST = {
  events: EVENTS,
  triggers: TRIGGERS,
  ciProviders: CI_PROVIDERS,
  packageManagers: PACKAGE_MANAGERS,
  loaderKinds: LOADER_KINDS,
  modes: MODES,
  diffMethods: DIFF_METHODS,
  deprecatedOptions: DEPRECATED_OPTIONS,
  hierarchies: HIERARCHIES,
  formatterPresets: FORMATTER_PRESETS,
  formatterPackagePattern: "^@graphql-markdown/[a-z0-9-]+(/[a-z0-9-]+)*$",
  knownLoaders: KNOWN_LOADERS,
  maskTokens: MASK_TOKENS,
  keyTokenPattern: KEY_TOKEN_PATTERN,
  graphqlMajorUnknown: "unknown",
} as const;

/** Supported payload schema versions (`v`). */
export const SCHEMA_VERSIONS = [1] as const;

/** Values of `process.platform`. Worker-side addition, not in the client schema. */
export const OS_NAMES = [
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
] as const;

export const UNKNOWN_VALUE = "unknown-value";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const FORMATTER_PACKAGE = new RegExp(ALLOWLIST.formatterPackagePattern);
const KEY_TOKEN = new RegExp(ALLOWLIST.keyTokenPattern);
/** Plain option names such as `rootPath` (no path, URL or host characters). */
const OPTION_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_DEPTH = 8;

/** Every string that may appear as a value inside `config` and `cli`. */
const VALUE_STRINGS = new Set<string>([
  ...CI_PROVIDERS,
  ...PACKAGE_MANAGERS,
  ...LOADER_KINDS,
  ...MODES,
  ...DIFF_METHODS,
  ...DEPRECATED_OPTIONS,
  ...HIERARCHIES,
  ...FORMATTER_PRESETS,
  ...KNOWN_LOADERS,
  ...MASK_TOKENS,
]);
const KNOWN_LOADER_SET = new Set<string>(KNOWN_LOADERS);

export type ValidationFailure = "schema" | "schema-version";
export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: ValidationFailure };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isCount = (value: unknown, max: number): value is number => {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
};

const FAIL = Symbol("fail");
type Checked<T> = T | typeof FAIL;

/** Enum string; unknown strings become `"unknown-value"`, non-strings fail. */
const enumValue = (
  value: unknown,
  allowed: readonly string[],
): Checked<string> => {
  if (typeof value !== "string") {
    return FAIL;
  }
  return allowed.includes(value) ? value : UNKNOWN_VALUE;
};

const sanitizeSection = (value: unknown, depth: number): Checked<unknown> => {
  if (depth > MAX_DEPTH) {
    return FAIL;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : FAIL;
  }
  if (typeof value === "string") {
    return VALUE_STRINGS.has(value) || FORMATTER_PACKAGE.test(value)
      ? value
      : FAIL;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const checked = sanitizeSection(item, depth + 1);
      if (checked === FAIL) {
        return FAIL;
      }
      out.push(checked);
    }
    return out;
  }
  if (isObject(value)) {
    const out: Json = {};
    for (const [key, item] of Object.entries(value)) {
      if (
        !KEY_TOKEN.test(key) &&
        !OPTION_KEY.test(key) &&
        !KNOWN_LOADER_SET.has(key)
      ) {
        return FAIL;
      }
      const checked = sanitizeSection(item, depth + 1);
      if (checked === FAIL) {
        return FAIL;
      }
      out[key] = checked;
    }
    return out;
  }
  return FAIL;
};

const validateLoader = (value: unknown): Checked<string | string[]> => {
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      const checked = enumValue(item, LOADER_KINDS);
      if (checked === FAIL) {
        return FAIL;
      }
      out.push(checked);
    }
    return out;
  }
  return enumValue(value, LOADER_KINDS);
};

/**
 * Validate an incoming payload against the allowlist. Returns a copy that
 * contains only known keys, with unknown enum values replaced by
 * `"unknown-value"`.
 */
export const validate = (payload: unknown): ValidationResult => {
  const fail = (reason: ValidationFailure): ValidationResult => {
    return { ok: false, reason };
  };
  if (!isObject(payload)) {
    return fail("schema");
  }
  if (!(SCHEMA_VERSIONS as readonly unknown[]).includes(payload.v)) {
    return fail("schema-version");
  }

  const out: Json = { v: payload.v };

  const required: [string, readonly string[]][] = [
    ["event", EVENTS],
    ["trigger", TRIGGERS],
    ["pm", PACKAGE_MANAGERS],
    ["os", OS_NAMES],
  ];
  for (const [key, allowed] of required) {
    const checked = enumValue(payload[key], allowed);
    if (checked === FAIL) {
      return fail("schema");
    }
    out[key] = checked;
  }

  const optional: [string, readonly string[]][] = [
    ["ciProvider", CI_PROVIDERS],
    ["mode", MODES],
    ["target", FORMATTER_PRESETS],
  ];
  for (const [key, allowed] of optional) {
    if (payload[key] === undefined) {
      continue;
    }
    const checked = enumValue(payload[key], allowed);
    if (checked === FAIL) {
      return fail("schema");
    }
    out[key] = checked;
  }

  if (typeof payload.pkg !== "string") {
    return fail("schema");
  }
  out.pkg = FORMATTER_PACKAGE.test(payload.pkg) ? payload.pkg : UNKNOWN_VALUE;

  if (
    typeof payload.pkgVersion !== "string" ||
    !SEMVER.test(payload.pkgVersion)
  ) {
    return fail("schema");
  }
  out.pkgVersion = payload.pkgVersion;

  if (!isCount(payload.nodeMajor, 99)) {
    return fail("schema");
  }
  out.nodeMajor = payload.nodeMajor;

  if (
    payload.graphqlMajor !== ALLOWLIST.graphqlMajorUnknown &&
    !isCount(payload.graphqlMajor, 99)
  ) {
    return fail("schema");
  }
  out.graphqlMajor = payload.graphqlMajor;

  for (const key of ["ci", "firstRun", "container", "wsl"]) {
    if (typeof payload[key] !== "boolean") {
      return fail("schema");
    }
    out[key] = payload[key];
  }

  if (payload.loader !== undefined) {
    const loader = validateLoader(payload.loader);
    if (loader === FAIL) {
      return fail("schema");
    }
    out.loader = loader;
  }

  if (payload.unknownKeys !== undefined) {
    if (!isCount(payload.unknownKeys, 10_000)) {
      return fail("schema");
    }
    out.unknownKeys = payload.unknownKeys;
  }

  for (const section of ["config", "cli"]) {
    if (payload[section] === undefined) {
      continue;
    }
    if (!isObject(payload[section])) {
      return fail("schema");
    }
    const checked = sanitizeSection(payload[section], 0);
    if (checked === FAIL) {
      return fail("schema");
    }
    out[section] = checked;
  }

  return { ok: true, value: out };
};
