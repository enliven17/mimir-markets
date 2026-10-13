/**
 * Mimir Launch: the trading presets and sources the wizard offers (from snipad lib/types.ts). Only the sources the
 * Solana tick actually runs are offered (convex/launchSol.ts): DexScreener, Helius wallets, X mentions.
 */
import type { Condition, DataSource, Strategy } from "./types";

export const STRATEGIES: Partial<Record<Strategy, { label: string; blurb: string }>> = {
  trending: { label: "Trending", blurb: "Trending pairs with real volume and liquidity." },
  whale: { label: "Whale tracker", blurb: "Enters when wallets you pick buy." },
  social: { label: "X buzz", blurb: "Tokens whose contract is spreading on X." },
};

export const SOURCES: Partial<Record<DataSource, string>> = {
  dexscreener: "DexScreener",
  helius: "Wallets you follow",
  x: "X mentions",
};

export const PRESETS: Record<"trending" | "whale" | "social", { sources: DataSource[]; entry: Condition[] }> = {
  trending: { sources: ["dexscreener"], entry: [{ metric: "liquidityUsd", op: ">", value: 50_000 }, { metric: "volume1hUsd", op: ">", value: 100_000 }] },
  whale: { sources: ["helius", "dexscreener"], entry: [{ metric: "liquidityUsd", op: ">", value: 20_000 }] },
  social: { sources: ["x", "dexscreener"], entry: [{ metric: "mentions1h", op: ">", value: 20 }, { metric: "liquidityUsd", op: ">", value: 30_000 }] },
};

/** What the agent wallet keeps for minting its token (flow.ts LAUNCH_FEE_LAMPORTS, server-only). */
export const LAUNCH_FEE_SOL = 0.01;
