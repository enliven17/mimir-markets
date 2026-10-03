/**
 * Per-cycle evidence cache.
 *
 * Twenty personas often look at the same claim in one cycle. Without a cache
 * that is twenty fetches of the same resolution URL per claim, wasteful and
 * rate-limit-prone. The worker builds one Map per cycle and drops it after, so
 * a later cycle never reasons over stale evidence.
 */
import { BROWSER_USER_AGENT, fetchEvidence } from "../../../lib/server/evidence-fetcher";
import type { EvidenceCacheEntry } from "./types";

const MAX_CONTENT_CHARS = 6_000;

export async function getOrFetchEvidence(
  key: string,
  resolutionUrl: string,
  cache: Map<string, EvidenceCacheEntry>,
): Promise<EvidenceCacheEntry> {
  const hit = cache.get(key);
  if (hit) return hit;

  let entry: EvidenceCacheEntry;
  if (!resolutionUrl?.startsWith("http")) {
    entry = { text: "(No resolution URL provided)", fetcher: "none" };
  } else {
    try {
      const snap = await fetchEvidence(resolutionUrl, {
        maxChars: MAX_CONTENT_CHARS,
        // A bot UA lets a creator-controlled page tell the council apart (audit P0-2).
        userAgent: BROWSER_USER_AGENT,
      });
      entry = { text: snap.text, fetcher: snap.fetcher };
    } catch {
      // The error text can carry upstream detail; the persona only needs to know it failed.
      entry = { text: "(Failed to fetch evidence)", fetcher: "none" };
    }
  }
  cache.set(key, entry);
  return entry;
}
