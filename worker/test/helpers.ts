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
