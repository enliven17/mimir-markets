/**
 * Mainnet payout policy, applied to every oracle decision before it goes on chain (convex/arcOracle.ts).
 *
 * A market's creator controls its resolution page and can change it after others have staked, and a model reading a
 * scraped page can be talked into anything. So on mainnet a market pays out to a side only when the result rests on
 * something the creator cannot edit:
 *   1. a deterministic rule (a resolver spec), or prices from two or more independent feeds; or
 *   2. a resolution source on the allowlist (price feeds, sports and market data APIs); or
 *   3. a very confident verdict (≥ 90) that a second, independent source agrees with (two price feeds, or a council
 *      majority for the same side).
 * Anything else is turned into UNRESOLVABLE: everyone gets their stake back. Draws and refunds pass unchanged.
 * Off mainnet the policy only reports; it changes nothing.
 */
import { sealBundle, type VerdictBundle } from "./verdict-bundle";

/** Hosts whose data the creator cannot edit. Subdomains count (api.coingecko.com under coingecko.com). */
export const SOURCE_ALLOWLIST = [
  // Prices
  "coingecko.com",
  "coinmarketcap.com",
  "flashapi.trade",
  "dexscreener.com",
  "binance.com",
  "coinbase.com",
  "kraken.com",
  "pyth.network",
  // Sports
  "espn.com",
  "api-football.com",
  "thesportsdb.com",
  // Markets and other data
  "finance.yahoo.com",
  "nasdaq.com",
  "polymarket.com",
  "api.weather.gov",
  "open-meteo.com",
];

export function hostAllowed(url: string, extra: string[] = []): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return [...SOURCE_ALLOWLIST, ...extra].some((d) => host === d || host.endsWith(`.${d}`));
}

type Verdict = "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE";

export interface PolicyInput {
  verdict: { verdict: Verdict; confidence: number; explanation: string };
  bundle: Pick<VerdictBundle, "claim" | "prices" | "resolver" | "council">;
}

export type PolicyResult = { pay: true; reason: string } | { pay: false; reason: string };

function independentPrices(b: PolicyInput["bundle"]): boolean {
  return new Set((b.prices?.readings ?? []).map((r) => r.source.toLowerCase())).size >= 2;
}

function councilAgrees(b: PolicyInput["bundle"], verdict: Verdict): boolean {
  const votes = b.council?.votes ?? [];
  if (votes.length < 3) return false;
  return votes.filter((v) => v.verdict === verdict).length * 2 > votes.length;
}

export function payoutPolicy(input: PolicyInput, extraHosts: string[] = []): PolicyResult {
  const { verdict, bundle } = input;
  if (verdict.verdict === "DRAW" || verdict.verdict === "UNRESOLVABLE") return { pay: true, reason: "a refund needs no source" };
  if (bundle.resolver) return { pay: true, reason: "deterministic resolver rule" };
  if (independentPrices(bundle)) return { pay: true, reason: "prices from two or more independent feeds" };
  if (hostAllowed(bundle.claim.resolutionUrl, extraHosts)) return { pay: true, reason: "allowlisted resolution source" };
  if (verdict.confidence >= 90 && councilAgrees(bundle, verdict.verdict)) return { pay: true, reason: "≥90 confidence and a council majority agrees" };
  return { pay: false, reason: "the resolution source is not allowlisted and nothing independent confirms the result" };
}

/**
 * The decision as it goes on chain: unchanged when the policy allows it (or off mainnet), otherwise UNRESOLVABLE with
 * the reason recorded in the audit bundle and the bundle re-sealed, so the on-chain hash matches what is published.
 */
export function applyPayoutPolicy<D extends { verdict: PolicyInput["verdict"]; bundle: VerdictBundle; evidenceHash: Uint8Array }>(
  decision: D,
  mainnet: boolean,
  extraHosts: string[] = [],
): D & { policy: PolicyResult } {
  const policy = payoutPolicy(decision, extraHosts);
  if (!mainnet || policy.pay) return { ...decision, policy };
  const verdict = { verdict: "UNRESOLVABLE" as const, confidence: decision.verdict.confidence, explanation: `Refunded: ${policy.reason}. ${decision.verdict.explanation}`.slice(0, 500) };
  const bundle: VerdictBundle = { ...decision.bundle, adjustments: [...decision.bundle.adjustments, `mainnet payout policy: ${policy.reason} → UNRESOLVABLE`], finalVerdict: verdict };
  return { ...decision, verdict, bundle, evidenceHash: sealBundle(bundle).bytes, policy };
}
