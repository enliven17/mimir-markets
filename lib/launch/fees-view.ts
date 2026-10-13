// Mimir Launch: display helpers for fee allocations (rules: ./fees.ts), from snipad lib/fees-view.ts. Pure, shared by
// the wizard and the agent page.
import { CREATOR_SHARE_PCT, DEFAULT_ALLOCATION, PLATFORM_FEES, type Allocation, type Bucket } from "./fees";

export { DEFAULT_ALLOCATION };
export type { Allocation, Bucket };
export const PLATFORM_PCT = PLATFORM_FEES.platformPct;
export const LLM_PCT = PLATFORM_FEES.llmPct;
export const CREATOR_PCT = CREATOR_SHARE_PCT;
export const BUCKET_ORDER: Bucket[] = ["bankroll", "buyback", "creatorPayout", "holders"];

export const FEE_BUCKETS: Record<Bucket, { label: string; short: string; plain: string }> = {
  bankroll: { label: "Gas & bankroll", short: "gas & bankroll", plain: "Stays in the agent's wallet: pays its own gas and what it trades with." },
  buyback: { label: "Buyback & burn", short: "buyback", plain: "Buys the agent's own token on the market and burns it." },
  creatorPayout: { label: "To the owner", short: "owner", plain: "Sent to the owner's wallet once it reaches 0.01 SOL." },
  holders: { label: "To holders", short: "holders", plain: "Airdropped to the token's top holders, pro-rata, at most once a day." },
};

export type Slice = { key: Bucket | "platform" | "llm"; label: string; pct: number };

/** Share of every claim, percent of the whole claim (platform and AI first), in display order. */
export function slices(a: Allocation): Slice[] {
  return [
    { key: "platform", label: "Platform", pct: PLATFORM_PCT },
    { key: "llm", label: "AI costs", pct: LLM_PCT },
    ...BUCKET_ORDER.map((b) => ({ key: b, label: FEE_BUCKETS[b].label, pct: (a[b] * CREATOR_PCT) / 100 })),
  ];
}

/** "0.10 platform · 0.10 AI costs · 0.48 gas & bankroll · …" for 1 SOL of fees. */
export function perSol(a: Allocation, to: { creator?: string } = {}): string {
  const name = (k: Slice["key"]) => (k === "platform" ? "platform" : k === "llm" ? "AI costs" : k === "creatorPayout" ? (to.creator ?? "to the owner") : k === "holders" ? "to holders" : FEE_BUCKETS[k].short);
  return slices(a).map((s) => `${(s.pct / 100).toFixed(2)} ${name(s.key)}`).join(" · ");
}

/** "buyback 30 → 10, holders 0 → 20" (only what changed). */
export function changeText(from: Allocation, to: Allocation): string {
  const parts = BUCKET_ORDER.filter((b) => from[b] !== to[b]).map((b) => `${FEE_BUCKETS[b].short} ${from[b]} → ${to[b]}`);
  return parts.length ? parts.join(", ") : "no change";
}

/**
 * Move `delta` points into bucket `b`, taken from (or given back to) the bankroll, which holds whatever is left.
 * Clamped so every bucket stays in 0..100 and the four always sum to 100.
 */
export function nudge(a: Allocation, b: Exclude<Bucket, "bankroll">, delta: number): Allocation {
  const room = a.bankroll;
  const next = Math.round(Math.min(a[b] + room, Math.max(0, a[b] + delta)));
  return { ...a, [b]: next, bankroll: a.bankroll - (next - a[b]) };
}

export const sumsTo100 = (a: Allocation) => BUCKET_ORDER.reduce((s, b) => s + a[b], 0) === 100 && BUCKET_ORDER.every((b) => Number.isInteger(a[b]) && a[b] >= 0);
