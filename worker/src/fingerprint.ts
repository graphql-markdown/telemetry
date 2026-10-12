type Json = Record<string, unknown>;

/** JSON with object keys sorted recursively. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Json)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

/** The formatter, from `config` or `cli` (`formatter`, then legacy `mdxParser`). */
export const formatterOf = (payload: Json): string => {
  for (const section of [payload.config, payload.cli]) {
    if (typeof section === "object" && section !== null) {
      const source = section as Json;
      for (const key of ["formatter", "mdxParser"]) {
        if (typeof source[key] === "string") {
          return source[key];
        }
      }
    }
  }
  return "";
};

/**
 * Server-side fingerprints. `fpShape` hashes only the masked config, loader
 * and formatter, so catalog identity is stable across versions, events and
 * targets. `fp` adds pkgVersion, graphqlMajor, event and target. Per-machine
 * fields (os, nodeMajor, pm, ci, ciProvider, container, wsl, firstRun,
 * trigger) are excluded from both.
 */
export const fingerprints = async (
  payload: Json,
): Promise<{ fp: string; fpShape: string }> => {
  const shape = {
    config: payload.config ?? null,
    loader: payload.loader ?? null,
    formatter: formatterOf(payload),
  };
  const full = {
    ...shape,
    pkgVersion: payload.pkgVersion,
    graphqlMajor: payload.graphqlMajor,
    event: payload.event,
    target: payload.target ?? null,
  };
  return {
    fp: await sha256Hex(canonicalJson(full)),
    fpShape: await sha256Hex(canonicalJson(shape)),
  };
};
