import { z } from "zod";
import { AVATAR_SEED_RE } from "../avatar/spec";
import { Trading, Markets } from "../launch/inputs";

export const DemoCreateBody = z.object({
  name: z.string().trim().min(2).max(32),
  ticker: z.string().regex(/^[A-Z0-9]{2,10}$/),
  avatarSeed: z.string().regex(AVATAR_SEED_RE).optional(),
  thesis: z.string().max(600).default(""),
  chain: z.enum(["solana", "arc", "robinhood"]),
  trading: Trading,
  markets: Markets,
}).refine((b) => b.trading.enabled || b.markets.enabled, "Turn on markets, trading or both.")
  .refine((b) => b.chain !== "arc" || !b.trading.enabled, "Arc agents stake on markets only.")
  .refine((b) => !b.markets.create.enabled, "Preview agents cannot open real markets.")
  .refine((b) => b.chain !== "robinhood" || !b.trading.enabled || b.trading.strategy.sources.every((s) => s === "pumpfun" || s === "dexscreener"), "Choose Pons sources for Robinhood.")
  // The demo shares public price snapshots. Paid wallet/social feeds are never silently substituted.
  .refine((b) => b.chain !== "solana" || !b.trading.enabled || b.trading.strategy.sources.every((s) => s === "dexscreener"), "The public preview supports DexScreener; wallet and social feeds are available in live mode.");

export const DemoBasketBody = z.object({
  name: z.string().trim().min(2).max(48), thesis: z.string().trim().max(600).default(""),
  members: z.array(z.object({ agentId: z.string().min(1).max(100), weightBps: z.number().int().min(1).max(10_000) })).min(1).max(3),
}).refine((b) => new Set(b.members.map((m) => m.agentId)).size === b.members.length, "Choose each agent once.")
  .refine((b) => b.members.reduce((s, m) => s + m.weightBps, 0) === 10_000, "Weights must add up to 100%.");
