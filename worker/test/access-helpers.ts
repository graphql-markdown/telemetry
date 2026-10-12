import { vi } from "vitest";

export const TEAM = "team.cloudflareaccess.com";
export const AUD = "aud-tag-123";

const b64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const text = (value: unknown): string =>
  b64url(new TextEncoder().encode(JSON.stringify(value)));

const generate = async () =>
  (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

let pair: CryptoKeyPair | undefined;

/** Sign a token with the test key; mocks the JWKS fetch for TEAM. */
export const signToken = async (
  claims: Record<string, unknown> = {},
  kid = "k1",
): Promise<string> => {
  pair ??= await generate();
  const header = text({ alg: "RS256", kid });
  const body = text({
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(`${header}.${body}`),
    ),
  );
  return `${header}.${body}.${b64url(signature)}`;
};

/** Make fetch(JWKS) answer with the test public key. Returns the spy. */
export const mockJwks = async () => {
  pair ??= await generate();
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ keys: [{ ...jwk, kid: "k1" }] }));
};
