/**
 * The testnet campaign's scoring rules, shared by the API and the page so the
 * table on screen is the formula the server runs.
 *
 * Pure and isomorphic. Points come from devnet activity a wallet already
 * leaves in the read-index: volume it (or its agents) staked, agents it
 * connected, baskets it made or follows, copy trades executed for it, and the
 * people it invited.
 */

import type { TokenTier } from "./token-tiers";

export interface CampaignMetrics {
  /** USDC staked on devnet: as creator or challenger, by the wallet or by an agent it owns. */
  volumeUsdc: number;
  agents: number;
  baskets: number;
  follows: number;
  copies: number;
}

/** Points per unit, and the most units that count (anti-farming). */
export const CAMPAIGN_WEIGHTS: Record<keyof CampaignMetrics, { label: string; unit: string; points: number; cap: number | null }> = {
  volumeUsdc: { label: "Devnet volume", unit: "per USDC staked", points: 10, cap: null },
  agents: { label: "Agents connected", unit: "per active agent", points: 500, cap: 5 },
  baskets: { label: "Baskets created", unit: "per basket", points: 300, cap: 5 },
  follows: { label: "Baskets followed", unit: "per basket", points: 100, cap: 20 },
  copies: { label: "Copy trades", unit: "per executed copy", points: 50, cap: null },
};

/** Per invited wallet that has any points of its own, plus a share of what it earns. */
export const INVITE_POINTS = 250;
export const INVITE_SHARE = 0.1;
/** An invited wallet's own points are multiplied by this. */
export const INVITED_MULTIPLIER = 1.1;
/** The first wallets to join get this on their own points, and the early badge. */
export const EARLY_SLOTS = 100;
export const EARLY_MULTIPLIER = 1.5;

/**
 * $MIMIR holders score more, by the product's own tiers (lib/token-tiers.ts:
 * 10k / 1M / 10M MIMIR on mainnet). Read from the wallet's current balance.
 */
export const HOLDER_MULTIPLIER: Record<TokenTier, number> = {
  none: 1,
  holder: 1.2,
  backer: 1.5,
  "oracle-circle": 2,
};
export const HOLDER_TIER_LABEL: Record<TokenTier, string> = {
  none: "",
  holder: "Holder",
  backer: "Backer",
  "oracle-circle": "Oracle circle",
};

export const INVITE_CODE_PATTERN = /^[A-Z0-9]{8}$/;

export function baseScore(m: CampaignMetrics): number {
  let total = 0;
  for (const key of Object.keys(CAMPAIGN_WEIGHTS) as (keyof CampaignMetrics)[]) {
    const { points, cap } = CAMPAIGN_WEIGHTS[key];
    total += Math.min(m[key], cap ?? Infinity) * points;
  }
  return total;
}

/** What a wallet signs to join (free, no transaction). The invite code it names cannot be changed later. */
export function campaignJoinMessage(wallet: string, inviteCode: string | null): string {
  return ["Join the Mimir testnet campaign", `wallet: ${wallet}`, `invited by: ${inviteCode ?? "none"}`].join("\n");
}
