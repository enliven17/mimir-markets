// Combining candidates from several sources: one entry per mint, metrics unioned (first known
// value wins, later sources only fill gaps), notes joined.
import type { Candidate } from "../ports";
import { isPrice } from "./sol";

/** A Solana mint (base58) or a Robinhood Chain token (0x, checksummed by its source so it compares exactly). */
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/;
export const isMint = (s: unknown): s is string => typeof s === "string" && MINT_RE.test(s);

function fill(a: Candidate, b: Candidate): Candidate {
  const metrics = { ...a.metrics };
  for (const [k, v] of Object.entries(b.metrics ?? {}) as [keyof Candidate["metrics"], number | undefined][]) {
    if (metrics[k] === undefined && typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
  }
  const notes = [a.note, b.note].filter((n): n is string => !!n && n.trim() !== "");
  return {
    ...a,
    symbol: a.symbol?.trim() ? a.symbol : b.symbol,
    name: a.name ?? b.name,
    ...(a.creator === undefined && b.creator ? { creator: b.creator } : {}),
    priceSol: isPrice(a.priceSol) ? a.priceSol : isPrice(b.priceSol) ? b.priceSol : null,
    metrics,
    note: notes.length ? [...new Set(notes)].join(" | ") : undefined,
  };
}

/** Dedupe by mint, dropping malformed mints. Order follows first appearance. */
export function mergeCandidates(lists: readonly (readonly Candidate[])[]): Candidate[] {
  const byMint = new Map<string, Candidate>();
  for (const list of lists) {
    for (const c of list) {
      if (!c || !isMint(c.mint)) continue;
      const prev = byMint.get(c.mint);
      byMint.set(c.mint, prev ? fill(prev, c) : { ...c, metrics: { ...c.metrics } });
    }
  }
  return [...byMint.values()];
}

/** Fill gaps in `base` from `extra` (same mint), never overwriting known values. */
export function enrichWith(base: readonly Candidate[], extra: readonly Candidate[]): Candidate[] {
  const byMint = new Map(extra.map((c) => [c.mint, c]));
  return base.map((c) => {
    const e = byMint.get(c.mint);
    return e ? fill(c, e) : c;
  });
}
