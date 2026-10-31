/**
 * Allowlist schema, vendored from the client.
 *
 * Source: graphql-markdown/graphql-markdown, packages/telemetry/src/schema.ts
 * (payload shape: packages/telemetry/src/payload.ts).
 *
 * TODO: replace this copy with `@graphql-markdown/telemetry/schema` once that
 * subpath is published, and let Renovate keep it up to date.
 */

export const EVENTS = [
  "config",
  "create_scaffold",
  "create_wire",
  "generate",
] as const;
export const TRIGGERS = [
  "cli",
  "create",
  "docusaurus",
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
  "<number>",
] as const;
/** Pattern of masked object keys, e.g. `<key:0>`. */
export const KEY_TOKEN_PATTERN = "^<key:\\d{1,6}>$";

/** Error names allowed in `errorType` (generate events only). */
export const ERROR_TYPES = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "GraphQLError",
  "AggregateError",
  "AbortError",
  "SystemError",
  "<custom-error>",
] as const;
/**
 * `errorType`: an allowlisted name with an optional system code suffix
 * (`:ENOENT`), or `<no-schema>`; any of them may be prefixed with `post:`.
 */
export const ERROR_TYPE_PATTERN = `^(post:)?((${ERROR_TYPES.join("|")})(:E[A-Z]{1,19})?|<no-schema>)$`;
/** Numeric bounds of the generate fields. */
export const MAX_PAGES = 1_000_000;
export const MAX_DURATION_MS = 86_400_000;
const ERROR_TYPE = new RegExp(ERROR_TYPE_PATTERN);

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
  errorTypes: ERROR_TYPES,
  errorTypePattern: ERROR_TYPE_PATTERN,
  maxPages: MAX_PAGES,
  maxDurationMs: MAX_DURATION_MS,
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

/** Exact package names; anything else is never stored. */
const PACKAGE_NAMES: ReadonlySet<string> = new Set([
  ...[
    "cli",
    "core",
    "docusaurus",
    "formatters",
    "graphql",
    "helpers",
    "logger",
    "printer-legacy",
    "types",
    "utils",
    "diff",
    "nuxt-theme",
    "telemetry",
  ].map((name) => `@graphql-markdown/${name}`),
  "create-graphql-markdown-docs",
  // Default formatter of the Docusaurus plugin (packages/docusaurus/src/index.ts).
  "@graphql-markdown/docusaurus/mdx",
  ...FORMATTER_PRESETS.map((name) => `@graphql-markdown/formatters/${name}`),
]);
const PRE_TAGS = "alpha|beta|rc|canary|next";
const VERSION_LOOSE = new RegExp(
  `^(\\d{1,4}\\.\\d{1,4})(\\.\\d{1,4})?(?:-(${PRE_TAGS})(?:\\.\\d{1,3})?(?![0-9A-Za-z]))?`,
);
const MAX_ITEMS = 50;
const MAX_INT = 1000;

/** Closed-set version truncated to major.minor (plus prerelease tag, no counter), else `unknown-value`. */
export const truncateVersion = (value: unknown): string => {
  if (typeof value !== "string") {
    return UNKNOWN_VALUE;
  }
  const match = VERSION_LOOSE.exec(value);
  if (match === null || (match[3] === undefined && value !== `${match[1]}${match[2] ?? ""}`)) {
    return UNKNOWN_VALUE;
  }
  return match[3] === undefined ? match[1] : `${match[1]}-${match[3]}`;
};

const inRange = (value: unknown, min: number, max: number): boolean => {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
};
const KEY_TOKEN = new RegExp(ALLOWLIST.keyTokenPattern);
const MAX_DEPTH = 8;

/** Every string that may appear as a value inside `config` and `cli`. */
export const VALUE_STRINGS = new Set<string>([
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
  "natural",
]);

/**
 * Option names, vendored from the client rule tables (CONFIG_RULES and
 * CLI_RULES in packages/telemetry/src/sanitize.ts).
 */
export const CONFIG_KEYS: ReadonlySet<string> = new Set([
  "baseURL",
  "customDirective",
  "decorators",
  "diffMethod",
  "docOptions",
  "force",
  "groupByDirective",
  "homepage",
  "id",
  "linkRoot",
  "loaders",
  "formatter",
  "mdxParser",
  "metatags",
  "onlyDocDirective",
  "outputAdapter",
  "pretty",
  "printTypeOptions",
  "rootPath",
  "schema",
  "skipDocDirective",
  "telemetry",
  "tmpDir",
]);
export const CLI_KEYS: ReadonlySet<string> = new Set([
  "base",
  "config",
  "deprecated",
  "diff",
  "force",
  "groupByDirective",
  "homepage",
  "index",
  "link",
  "hierarchy",
  "formatter",
  "mdxParser",
  "noParentType",
  "noTypeBadges",
  "noSectionId",
  "pretty",
  "root",
  "schema",
  "skip",
  "only",
  "tmp",
  "telemetry",
]);

const NO_NAMES: ReadonlySet<string> = new Set();
/** Loader entries are `{ [loaderName]: { module, options } }`. */
const LOADER_NAMES: ReadonlySet<string> = new Set([
  ...KNOWN_LOADERS,
  "<custom-loader>",
  "module",
  "options",
]);
/** Known field names of nested objects (config only). */
const NESTED_NAMES: Record<string, ReadonlySet<string>> = {
  printTypeOptions: new Set([
    "deprecated",
    "exampleSection",
    "hierarchy",
    "parentTypePrefix",
    "typeBadges",
  ]),
  docOptions: new Set([
    "frontMatter",
    "index",
    "generatorFrameworkName",
    "generatorFrameworkVersion",
    "categorySort",
    "sectionHeaderId",
  ]),
  groupByDirective: new Set(["directive", "field", "fallback"]),
  loaders: LOADER_NAMES,
};

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

/**
 * `names` are the option names allowed as keys at this object level; `<key:n>`
 * tokens are always allowed. Below the top level only loaders keep names.
 */
const sanitizeSection = (
  value: unknown,
  depth: number,
  names: ReadonlySet<string>,
): Checked<unknown> => {
  if (depth > MAX_DEPTH) {
    return FAIL;
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return FAIL;
    }
    return Number.isInteger(value) && value >= 0 && value <= MAX_INT
      ? value
      : "<number>";
  }
  if (typeof value === "string") {
    if (VALUE_STRINGS.has(value) || PACKAGE_NAMES.has(value)) {
      return value;
    }
    return value.startsWith("@graphql-markdown/") ? UNKNOWN_VALUE : FAIL;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_ITEMS)) {
      const checked = sanitizeSection(item, depth + 1, names);
      if (checked === FAIL) {
        return FAIL;
      }
      out.push(checked);
    }
    return out;
  }
  if (isObject(value)) {
    const out: Json = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS)) {
      if (!KEY_TOKEN.test(key) && !names.has(key)) {
        return FAIL;
      }
      const childNames =
        depth === 0
          ? (NESTED_NAMES[key] ?? NO_NAMES)
          : names === LOADER_NAMES
            ? LOADER_NAMES
            : NO_NAMES;
      const checked = sanitizeSection(item, depth + 1, childNames);
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
  out.pkg = PACKAGE_NAMES.has(payload.pkg) ? payload.pkg : UNKNOWN_VALUE;

  out.pkgVersion = truncateVersion(payload.pkgVersion);

  out.nodeMajor = inRange(payload.nodeMajor, 18, 40)
    ? payload.nodeMajor
    : UNKNOWN_VALUE;

  out.graphqlMajor =
    payload.graphqlMajor === ALLOWLIST.graphqlMajorUnknown ||
    inRange(payload.graphqlMajor, 14, 30)
      ? payload.graphqlMajor
      : UNKNOWN_VALUE;

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
    const checked = sanitizeSection(
      payload[section],
      0,
      section === "config" ? CONFIG_KEYS : CLI_KEYS,
    );
    if (checked === FAIL) {
      return fail("schema");
    }
    out[section] = checked;
  }

  const generate = out.event === "generate";
  const hasGenerateField = ["pages", "durationMs", "errorType"].some(
    (key) => payload[key] !== undefined,
  );
  if (!generate && hasGenerateField) {
    return fail("schema");
  }
  if (generate) {
    if (
      payload.config !== undefined ||
      payload.cli !== undefined ||
      payload.loader !== undefined
    ) {
      return fail("schema");
    }
    if (!isCount(payload.pages, MAX_PAGES)) {
      return fail("schema");
    }
    out.pages = payload.pages;
    if (
      !isCount(payload.durationMs, MAX_DURATION_MS) ||
      payload.durationMs % 100 !== 0
    ) {
      return fail("schema");
    }
    out.durationMs = payload.durationMs;
    if (payload.errorType !== undefined) {
      if (
        typeof payload.errorType !== "string" ||
        !ERROR_TYPE.test(payload.errorType)
      ) {
        return fail("schema");
      }
      out.errorType = payload.errorType;
    }
  }

  return { ok: true, value: out };
};
