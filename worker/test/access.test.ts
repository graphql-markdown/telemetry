import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAccessCache, verifyAccess } from "../src/access";
import type { Env } from "../src/env";
import { AUD, mockJwks, signToken, TEAM } from "./access-helpers";

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as unknown as Env;
const req = (token?: string) =>
  new Request("https://telemetry.test/v1/stats", {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
  });

beforeEach(async () => {
  resetAccessCache();
  await mockJwks();
});
afterEach(() => vi.restoreAllMocks());

describe("verifyAccess", () => {
  it("accepts a valid token", async () => {
    expect(await verifyAccess(req(await signToken()), env)).toBe(true);
  });

  it("rejects a missing header", async () => {
    expect(await verifyAccess(req(), env)).toBe(false);
  });

  it("rejects a wrong audience, issuer or an expired token", async () => {
    expect(await verifyAccess(req(await signToken({ aud: ["other"] })), env)).toBe(false);
    expect(await verifyAccess(req(await signToken({ iss: "https://evil" })), env)).toBe(false);
    expect(await verifyAccess(req(await signToken({ exp: 1 })), env)).toBe(false);
  });

  it("rejects a tampered signature, malformed token or unknown kid", async () => {
    const token = await signToken();
    const [h, p, s] = token.split(".");
    expect(await verifyAccess(req(`${h}.${p}.${s.slice(0, -4)}AAAA`), env)).toBe(false);
    expect(await verifyAccess(req("not-a-jwt"), env)).toBe(false);
    expect(await verifyAccess(req(await signToken({}, "zzz")), env)).toBe(false);
  });

  it("fails closed when the variables are unset", async () => {
    const token = await signToken();
    expect(await verifyAccess(req(token), {} as unknown as Env)).toBe(false);
  });
});
