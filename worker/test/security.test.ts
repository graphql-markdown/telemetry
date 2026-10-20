import { describe, expect, it } from "vitest";

import headers from "../../dashboard/_headers?raw";
import type { Env } from "../src/env";
import worker from "../src/index";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";

describe("security headers", () => {
  const env = {} as unknown as Env;

  it("sets the CSP on dashboard API responses, including rejections", async () => {
    const res = await worker.fetch(new Request("https://telemetry.test/v1/stats"), env);
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
  });

  it("sends the same CSP for the static dashboard via _headers", () => {
    expect(headers).toContain(`Content-Security-Policy: ${CSP}`);
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Referrer-Policy: no-referrer");
  });
});
