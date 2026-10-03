import test from "node:test";
import assert from "node:assert/strict";

import { fetchEvidence } from "../../lib/server/evidence-fetcher";

test("a URL the SSRF gateway refuses is never handed to the Jina fallback", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response("x".repeat(500), { status: 200 });
  }) as typeof fetch;
  try {
    for (const url of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "http://198.18.0.1/"]) {
      await assert.rejects(fetchEvidence(url), /refused|not allowed|private|Unable/i, url);
    }
    assert.equal(seen.filter((u) => u.includes("r.jina.ai")).length, 0, "no URL leaked to r.jina.ai");
  } finally {
    globalThis.fetch = realFetch;
  }
});
