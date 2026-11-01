/**
 * Linked markets: the same question opened by Mimir's own agents (the house creator, a launch agent) on every enabled
 * chain. Each chain's market is its own (own contract, own stakes, own payouts); a shared `pairKey` on both index rows
 * ties them together, so the page links "also on Base/Arc" and the oracle settles them alike.
 *
 * Settlement: the outcome is decided once (evidence + model, agents/oracle/decide.ts) and the same decision is
 * proposed on every linked market. What stays per market is what depends on that market's own stakes: an uncontested
 * pool refunds (DRAW), and a market with stakes placed after the outcome was known refunds (lib/late-stakes.ts).
 * Pure: tests/node/chain-linked.test.ts.
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import type { MarketChainId } from "./registry";

/**
 * The link id for one market drafted for several chains: stable for the same draft (question, deadline, source), so a
 * retry after a partial failure lands on the same pair. `scope` keeps different openers apart ("house", "agent:<slug>").
 */
export function pairKeyOf(scope: string, d: { question: string; deadline: number; resolutionUrl: string }): string {
  const text = `${scope}\n${d.question.trim().toLowerCase()}\n${d.deadline}\n${d.resolutionUrl.trim()}`;
  return `${scope}:${bytesToHex(sha256(new TextEncoder().encode(text))).slice(0, 24)}`;
}

export interface LinkedVerdict {
  chain: MarketChainId;
  /** The side proposed on chain (may be a per-market refund). */
  side: number;
  /** The decided outcome before any per-market override; absent on a refund that decided nothing (uncontested pool). */
  decided?: number;
  confidence: number;
  summary: string;
  /** The decision's own summary when `summary` is a per-market override's. */
  decidedSummary?: string;
  evidenceHash: string;
  bundle: string;
}

/**
 * The decision a linked market reuses: the first one any sibling (another chain's market with the same pairKey) made.
 * Refunds that decided nothing (an uncontested pool's DRAW) are not decisions and are skipped. Null = decide afresh.
 */
export function siblingDecision(verdicts: readonly LinkedVerdict[], self: MarketChainId): LinkedVerdict | null {
  for (const v of verdicts) {
    if (v.chain === self || v.decided === undefined) continue;
    return v;
  }
  return null;
}

/**
 * The decision as the oracle proposes it on this market, ready for this market's own late-stake check: the sibling's
 * decided side, summary and audit bundle. A sibling bundle that carries its own late-stake override has it stripped;
 * its evidence hash is then null and the oracle re-seals the bundle (lib/verdict-bundle.ts).
 */
export function reuseDecision(v: LinkedVerdict): { side: number; confidence: number; summary: string; evidenceHash: string | null; bundle: string } {
  let bundle = v.bundle;
  let overridden = false;
  try {
    const b = JSON.parse(v.bundle) as Record<string, unknown> | null;
    if (b && typeof b === "object" && "lateStakeRefund" in b) {
      delete b.lateStakeRefund;
      bundle = JSON.stringify(b);
      overridden = true;
    }
  } catch {
    /* not JSON: reused as is */
  }
  return { side: v.decided ?? v.side, confidence: v.confidence, summary: v.decidedSummary ?? v.summary, evidenceHash: overridden ? null : v.evidenceHash, bundle };
}
