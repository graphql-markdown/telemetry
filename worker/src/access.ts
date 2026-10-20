import type { Env } from "./env";

/*
 * Privacy invariant, single exception. The Worker never reads request headers
 * other than Content-Type, Content-Encoding and Content-Length, EXCEPT
 * `Cf-Access-Jwt-Assertion` on the dashboard/stats routes (never on
 * /v1/event). It is used only to verify the Cloudflare Access
 * signature and audience. No claim (email, identity, ...) is read, logged or
 * stored.
 */

type Jwk = JsonWebKey & { kid?: string };
type Jwks = { keys?: Jwk[] };

const JWKS_TTL_MS = 10 * 60 * 1000;
let cache: { team: string; at: number; keys: Jwk[] } | undefined;

const loadKeys = async (team: string, force: boolean): Promise<Jwk[]> => {
  const now = Date.now();
  if (!force && cache && cache.team === team && now - cache.at < JWKS_TTL_MS) {
    return cache.keys;
  }
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new Error(`Access JWKS answered ${response.status}`);
  }
  const body = (await response.json()) as Jwks;
  cache = { team, at: now, keys: body.keys ?? [] };
  return cache.keys;
};

const decode = (part: string): Uint8Array => {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const parseJson = (part: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(decode(part)));
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Second check behind Cloudflare Access: true only when the
 * `Cf-Access-Jwt-Assertion` header carries a valid RS256 token signed by the
 * team's JWKS, for our audience, issuer and not expired. Fails closed when the
 * variables are unset.
 */
export const verifyAccess = async (request: Request, env: Env): Promise<boolean> => {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!team || !aud || !token) {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }
  const header = parseJson(parts[0]);
  const claims = parseJson(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") {
    return false;
  }
  try {
    let jwk = (await loadKeys(team, false)).find((key) => key.kid === header.kid);
    if (!jwk) {
      jwk = (await loadKeys(team, true)).find((key) => key.kid === header.kid);
    }
    if (!jwk) {
      return false;
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]), signed))) {
      return false;
    }
  } catch {
    return false;
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return (
    audiences.includes(aud) &&
    claims.iss === `https://${team}` &&
    typeof claims.exp === "number" &&
    claims.exp > Date.now() / 1000
  );
};

/** Test helper: forget the cached JWKS. */
export const resetAccessCache = (): void => {
  cache = undefined;
};
