/** Maximum body size, on the wire and decompressed. */
export const MAX_BYTES = 8 * 1024;

export type BodyResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "size" | "encoding" };

/**
 * Reads a stream, aborting as soon as more than `limit` bytes were seen.
 * Returns null when the limit is exceeded.
 */
const readLimited = async (
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * Reads the request body with the 8 KB cap on the wire and, for gzip,
 * decompressed. Only `Content-Encoding` and `Content-Length` are read.
 */
export const readBody = async (request: Request): Promise<BodyResult> => {
  const encoding = (request.headers.get("content-encoding") ?? "")
    .trim()
    .toLowerCase();
  if (encoding !== "" && encoding !== "identity" && encoding !== "gzip") {
    return { ok: false, reason: "encoding" };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return { ok: false, reason: "size" };
  }
  if (request.body === null) {
    return { ok: true, bytes: new Uint8Array(0) };
  }
  const wire = await readLimited(request.body, MAX_BYTES);
  if (wire === null) {
    return { ok: false, reason: "size" };
  }
  if (encoding !== "gzip") {
    return { ok: true, bytes: wire };
  }
  try {
    const inflated = new Blob([wire])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const bytes = await readLimited(inflated, MAX_BYTES);
    return bytes === null
      ? { ok: false, reason: "size" }
      : { ok: true, bytes };
  } catch {
    return { ok: false, reason: "encoding" };
  }
};
