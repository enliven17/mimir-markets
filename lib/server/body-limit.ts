/**
 * Bounded JSON body reads for POST routes (audit P1-10). `req.json()` reads
 * whatever the client sends; this rejects a declared Content-Length over the
 * cap before touching the stream, and stops reading once the actual bytes
 * pass it (a missing or lying header does not lift the cap).
 */

/** Every POST body in app/api fits well under this. */
export const MAX_BODY_BYTES = 16 * 1024;

export type LimitedJson = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

export async function readLimitedJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<LimitedJson> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared.trim()) || Number(declared) > maxBytes)) {
    return { ok: false, status: 413 };
  }
  if (!req.body) return { ok: false, status: 400 };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400 };
  }
}
