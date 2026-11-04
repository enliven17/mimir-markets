/**
 * Linked markets: the same question opened by Mimir's own agents (the house creator, a launch agent) on every enabled
 * chain. Each chain's market is its own (own contract, own stakes, own payouts); a shared `pairKey` on both index rows
 * ties them together, so the page links "also on Base/Arc" and the oracle settles them alike.
 *
 * Who links: the house creator and launch agents link the copies they open; the twin reconciler (convex/arcTwins.ts,
 * lib/chains/twins.ts) opens the missing leg of any public pool (a house draft that failed on one chain, a user's or
 * an agent's pool) from the house creator wallet and links it. VS duels are never mirrored.
 *
 * Settlement: the outcome is decided once per pairKey (evidence + model, agents/oracle/decide.ts), stored as the
 * pair's decision before anything is proposed, and the same decision is proposed on every leg. What stays per market
 * is what depends on that market's own stakes: an uncontested pool refunds (DRAW), and a market with stakes placed
 * after the outcome was known refunds (lib/late-stakes.ts). The council writes one take per pair, shown on every leg.
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
  /**
   * The pair's stored decision (arcPairDecisions), saved right after the model decided and before any proposal: any
   * leg reuses it, the deciding chain's own leg included (a proposal that failed is retried without a new decision).
   */
  stored?: boolean;
}

/**
 * The decision a linked market reuses: the pair's stored decision, else the first one any sibling (another chain's
 * market with the same pairKey) proposed. Refunds that decided nothing (an uncontested pool's DRAW) are not decisions
 * and are skipped. Null = decide afresh.
 */
export function siblingDecision(verdicts: readonly LinkedVerdict[], self: MarketChainId): LinkedVerdict | null {
  const usable = verdicts.filter((v) => v.decided !== undefined && (v.stored || v.chain !== self));
  return usable.find((v) => v.stored) ?? usable[0] ?? null;
}

/** The market chains in display order (Base first), for grouping legs. */
const ORDER: readonly MarketChainId[] = ["base", "arc"];

/**
 * Rows grouped by link: one group per pairKey (its legs in chain order, Base first), and a group of one for every
 * unlinked row. Groups keep the order of their first row. The feed shows one card per group; the council writes one
 * take per group (every leg shows it).
 */
export function groupLegs<T extends { chain: MarketChainId; pairKey?: string | null }>(rows: readonly T[]): Array<{ key: string; lead: T; legs: T[] }> {
  const groups = new Map<string, T[]>();
  rows.forEach((r, i) => {
    const key = r.pairKey ? `pair:${r.pairKey}` : `row:${i}`;
    const g = groups.get(key);
    if (g) {
      if (!g.some((x) => x.chain === r.chain)) g.push(r);
    } else groups.set(key, [r]);
  });
  return [...groups.entries()].map(([key, legs]) => {
    const sorted = [...legs].sort((a, b) => ORDER.indexOf(a.chain) - ORDER.indexOf(b.chain));
    return { key, lead: sorted[0], legs: sorted };
  });
}

/** The enabled chains a market (with legs on `have`) is still missing. */
export const missingChains = (have: readonly MarketChainId[], enabled: readonly MarketChainId[]): MarketChainId[] => enabled.filter((c) => !have.includes(c));

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
    if (b && typeof b === "object" && ("lateStakeRefund" in b || "lateDepositPolicy" in b)) {
      delete b.lateStakeRefund;
      delete b.lateDepositPolicy;
      bundle = JSON.stringify(b);
      overridden = true;
    }
  } catch {
    /* not JSON: reused as is */
  }
  return { side: v.decided ?? v.side, confidence: v.confidence, summary: v.decidedSummary ?? v.summary, evidenceHash: overridden ? null : v.evidenceHash, bundle };
}

/**
 * The council's one take per linked pair: a leg that already has a take is the source, copied to the legs without one
 * (no model call); no take on any leg means one call for the group, written to every leg.
 */
export function takeReuse<T>(legs: readonly T[], hasTake: (leg: T) => boolean): { source: T | null; missing: T[] } {
  const source = legs.find(hasTake) ?? null;
  return { source, missing: legs.filter((l) => !hasTake(l)) };
}

/**
 * The oracle's shared backoff for a linked market: while another leg's decision is deferred (its retry time, ms, is
 * still ahead), this leg waits too, so the pair is decided once instead of once per chain. Once the pair has a stored
 * decision, reusing it costs nothing and nothing waits.
 */
export const pairWaits = (siblingNotBefore: readonly number[], nowMs: number, hasPairDecision: boolean): boolean =>
  !hasPairDecision && siblingNotBefore.some((t) => t > nowMs);
