import { vi } from "vitest";

import type { Env } from "../src/env";

export const payload = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  event: "config",
  pkg: "@graphql-markdown/cli",
  pkgVersion: "1.2.3",
  nodeMajor: 24,
  graphqlMajor: 16,
  os: "darwin",
  ci: false,
  pm: "npm",
  firstRun: false,
  trigger: "cli",
  container: false,
  wsl: false,
  loader: "url",
  config: { schema: "<url>", formatter: "@graphql-markdown/docusaurus" },
  ...extra,
});

export const mockEnv = (overrides: Partial<Env> = {}) => {
  const events = { writeDataPoint: vi.fn() };
  const rejects = { writeDataPoint: vi.fn() };
  const env = {
    EVENTS: events,
    REJECTS: rejects,
    ...overrides,
  } as unknown as Env;
  return { env, events, rejects };
};

export const post = (
  body: BodyInit | null,
  headers: Record<string, string> = { "content-type": "application/json" },
  init: Record<string, unknown> = {},
) =>
  new Request("https://telemetry.test/v1/event", {
    method: "POST",
    body,
    headers,
    ...init,
  });

export const gzip = async (text: string): Promise<Uint8Array> => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Apply the D1 migrations to the (empty) test database, optionally only the first `upTo`. */
export const applyMigrations = async (db: D1Database, upTo = 6, from = 1): Promise<void> => {
  const sql = [
    (await import("../../migrations/0001_init.sql?raw")).default,
    (await import("../../migrations/0002_ci_split.sql?raw")).default,
    (await import("../../migrations/0003_catalog_daily.sql?raw")).default,
    (await import("../../migrations/0004_generate_daily.sql?raw")).default,
    (await import("../../migrations/0005_truncate_pkg_version.sql?raw")).default,
    (await import("../../migrations/0006_generate_errors_ci.sql?raw")).default,
  ]
    .slice(from - 1, upTo)
    .join("\n");
  const statements = sql
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement !== "");
  await db.batch(statements.map((statement) => db.prepare(statement)));
};
