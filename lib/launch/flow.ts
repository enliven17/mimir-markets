/**
 * Mimir Launch: launching an agent, in two calls (ported from snipad lib/server/launch.ts).
 *   1. create(): validate the owner's form, check a BYOK key with one tiny call, make the agent's two wallets
 *      (Solana: Privy, policy-locked to trading + SOL back to the owner/treasury; Arc: a Circle wallet) and store it pending.
 *   2. launch(): the owner has sent the seed SOL to the Solana wallet; verify it on chain, then the agent wallet mints
 *      its token on pump.fun as creator and the agent goes live.
 * State lives in Convex (convex/launch.ts); chain work happens here. Dependencies are injected for tests.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { AVATAR_SEED_RE } from "@/lib/avatar/spec";
import { BYOK_PROVIDERS, sealKey, type ByokProvider } from "./byok";
import { DEFAULT_MARKET_RULES } from "./markets";
import { allocationProblem, DEFAULT_ALLOCATION } from "./fees";
import type { verifyFunding } from "./funding";
import type { Cx } from "./request";

/** pump.fun create + rent + priority, paid by the agent wallet (~0.006 SOL measured in snipad); the rest is bankroll. */
export const LAUNCH_FEE_LAMPORTS = 10_000_000n;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const METRICS = ["liquidityUsd", "volume1hUsd", "ageMinutes", "holders", "devHoldPct", "mcapUsd", "curvePct", "mentions1h"] as const;
/** Convex documents are capped at 1 MB: an uploaded image stays well under it. */
const MAX_IMAGE_CHARS = 700_000;

const pctInt = z.number().int().min(0).max(100);
/** The owner's split of its 80% of every creator-fee claim: whole percents summing to 100. */
export const AllocationBody = z
  .object({ bankroll: pctInt, buyback: pctInt, creatorPayout: pctInt, holders: pctInt })
  .strict()
  .refine((a) => allocationProblem(a) === null, { message: "The four fee buckets must add up to 100." });

const Trading = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    strategy: z.object({
      preset: z.enum(["trending", "whale", "sniper", "social"]),
      sources: z.array(z.enum(["dexscreener", "pumpfun", "helius", "x", "birdeye"])).min(1).max(5),
      entry: z.array(z.object({ metric: z.enum(METRICS), op: z.enum([">", "<"]), value: z.number().finite().min(0) })).min(1).max(8),
      whales: z.array(z.string().regex(B58)).max(20).default([]),
    }).refine((s) => !s.sources.includes("helius") || s.whales.length > 0, { message: "Add at least one wallet to follow.", path: ["whales"] }),
    risk: z.object({
      slippageBps: z.number().int().min(50).max(1000),
      positionPct: z.number().min(1).max(25),
      stopLossPct: z.number().min(5).max(50),
      takeProfitPct: z.number().min(10).max(300),
      maxDailyLossPct: z.number().min(5).max(50),
    }),
    trailingStopPct: z.number().min(0).max(30).default(0),
    maxHoldMinutes: z.number().int().min(0).max(240).default(0),
  }),
]);

const Markets = z.object({
  enabled: z.boolean(),
  categories: z.array(z.string().trim().min(1).max(20)).max(12).default([]),
  minEdge: z.number().min(0.03).max(0.5).default(DEFAULT_MARKET_RULES.minEdge),
  kellyFraction: z.number().min(0.05).max(1).default(DEFAULT_MARKET_RULES.kellyFraction),
  maxStakeUsdc: z.number().min(0.1).max(50).default(DEFAULT_MARKET_RULES.maxStakeUsdc),
  maxHoursToClose: z.number().min(1).max(24 * 30).default(DEFAULT_MARKET_RULES.maxHoursToClose),
  /** The most it may have staked at once. */
  budgetUsdc: z.number().min(0).max(10_000).default(20),
});

const Brain = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mimir") }),
  z.object({
    kind: z.literal("byok"),
    provider: z.enum(Object.keys(BYOK_PROVIDERS) as [ByokProvider, ...ByokProvider[]]),
    apiKey: z.string().trim().min(16).max(400),
    model: z.string().trim().max(80).regex(/^[A-Za-z0-9._:/-]*$/).optional(),
  }),
]);

export const CreateBody = z.object({
  name: z.string().trim().min(2).max(32),
  ticker: z.string().regex(/^[A-Z0-9]{2,10}$/),
  description: z.string().max(280).default(""),
  thesis: z.string().max(600).default(""),
  /** Optional: without one, the token image is the agent's face (token-image.tsx). */
  image: z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/).max(MAX_IMAGE_CHARS, "Image is too large (about 500 KB max).").optional(),
  avatarSeed: z.string().regex(AVATAR_SEED_RE).optional(),
  brain: Brain,
  trading: Trading,
  markets: Markets,
  // 0 is fine: it launches on the launch fee alone and trades nothing until topped up.
  seedSol: z.number().min(0).max(100),
  /** Where the owner's 80% of every creator-fee claim goes (lib/launch/fees.ts). */
  allocation: AllocationBody.default(DEFAULT_ALLOCATION),
}).refine((b) => b.trading.enabled || b.markets.enabled, { message: "Turn on markets, trading or both.", path: ["markets"] });
export type CreateInput = z.infer<typeof CreateBody>;

export interface Wallets {
  /** The Solana wallet, policy-locked so SOL can only go back to `owner` (or the treasury). */
  solana: (owner: string) => Promise<{ id: string; address: string }>;
  arc: (slug: string) => Promise<{ id: string; address: string }>;
}
export type KeyCheck = (provider: ByokProvider, apiKey: string, model: string) => Promise<"ok" | "bad-key" | "busy">;
export type Launcher = (a: { walletId: string; wallet: string; name: string; symbol: string; description: string; imageDataUrl: string; devBuyLamports: bigint }) => Promise<{ mint: string; sig: string; metadataUri: string }>;
type Verify = typeof verifyFunding;

export async function create({ client, secret }: Cx, deps: { wallets: Wallets; checkKey: KeyCheck }, owner: string, input: CreateInput) {
  const slug = input.ticker.toLowerCase();
  const uid = randomUUID();
  // Check and seal the key before any wallet exists, so a bad key costs nothing.
  let brain: { kind: "mimir" } | { kind: "byok"; provider: string; sealed: string; last4: string; model: string } = { kind: "mimir" };
  if (input.brain.kind === "byok") {
    const sealed = sealKey(uid, input.brain.provider, input.brain.apiKey, input.brain.model);
    const label = BYOK_PROVIDERS[sealed.provider].label;
    const check = await deps.checkKey(sealed.provider, input.brain.apiKey, sealed.model);
    if (check === "bad-key") return { ok: false as const, status: 400, error: `${label} refused that key or model. Check both and try again.` };
    if (check === "busy") return { ok: false as const, status: 503, error: `${label} is rate-limiting that key or is down right now, so it could not be checked. Try again in a minute.` };
    brain = { kind: "byok", ...sealed };
  }
  const t = input.trading;
  const trading = t.enabled
    ? {
        enabled: true,
        config: { ...t.strategy, trailingStopPct: t.trailingStopPct || null, maxHoldMinutes: t.maxHoldMinutes || null, thesis: input.thesis, liveView: "public", copyTrade: false },
        risk: t.risk,
      }
    : { enabled: false, config: null, risk: null };
  const { enabled, budgetUsdc, ...rules } = input.markets;
  const solana = await deps.wallets.solana(owner);
  const arc = await deps.wallets.arc(slug);
  const fundLamports = BigInt(Math.round(input.seedSol * 1e9)) + LAUNCH_FEE_LAMPORTS;
  const r = await client.mutation(api.launch.createPending, {
    secret, slug, uid, owner, name: input.name, ticker: input.ticker, avatarSeed: input.avatarSeed ?? slug, thesis: input.thesis, brain, trading,
    markets: { enabled, budgetUsdc, rules: { ...DEFAULT_MARKET_RULES, ...rules } },
    solana: { walletId: solana.id, address: solana.address }, arc: { walletId: arc.id, address: arc.address },
    fundLamports: fundLamports.toString(), description: input.description, ...(input.image ? { image: input.image } : {}),
    allocation: input.allocation,
  });
  // Lost a race for the ticker after the wallets were made: they are simply never funded.
  if (!r.ok) return { ok: false as const, status: 409, error: `Too many agents named $${input.ticker}. Pick another ticker.` };
  return { ok: true as const, id: r.slug, solana: solana.address, arc: arc.address, fundLamports };
}

export async function launch(
  { client, secret }: Cx,
  deps: { verify: Verify; conn: Parameters<Verify>[0]; launchToken: Launcher; image: (avatarSeed: string) => Promise<string> },
  owner: string,
  id: string,
  fundingSig: string,
) {
  const a = await client.query(api.launch.forLaunch, { secret, slug: id });
  if (!a || a.owner !== owner || !a.solana || !a.launch) return { ok: false as const, status: 404, error: "No such agent." };
  if (a.mint) return { ok: true as const, mint: a.mint }; // already launched: idempotent
  if (a.status !== "pending") return { ok: false as const, status: 409, error: `Agent is ${a.status}.` };
  const funded = await deps.verify(deps.conn, { sig: fundingSig, from: owner, to: a.solana.address, minLamports: BigInt(a.launch.fundLamports) });
  if (!funded.ok) return { ok: false as const, status: 400, error: funded.error };
  // Drawn before the claim, so a failure here leaves nothing to release.
  let imageDataUrl = a.launch.image;
  if (!imageDataUrl) {
    try {
      imageDataUrl = await deps.image(a.avatarSeed);
    } catch (e) {
      console.error("launch token image:", e);
      return { ok: false as const, status: 500, error: "Could not draw the token image. Try again." };
    }
  }

  const claim = await client.mutation(api.launch.claimLaunch, { secret, slug: id, fundingSig });
  if (claim === "sig-used") return { ok: false as const, status: 409, error: "That funding transaction was already used for another agent. Send the SOL in a new transaction." };
  if (!claim) return { ok: false as const, status: 409, error: "Launch already in progress." };
  // Only the chain call is in this try: once a mint exists, nothing may release the claim.
  let r: Awaited<ReturnType<Launcher>>;
  try {
    r = await deps.launchToken({ walletId: a.solana.walletId, wallet: a.solana.address, name: a.name, symbol: a.ticker, description: a.launch.description, imageDataUrl, devBuyLamports: 0n });
  } catch (e) {
    const ambiguous = (e as { name?: string })?.name === "AmbiguousSendError";
    // Not ambiguous = provably did not land: release the claim so the owner can retry.
    if (!ambiguous) await client.mutation(api.launch.releaseLaunch, { secret, slug: id });
    await client.mutation(api.launch.logEvent, { secret, slug: id, kind: "error", text: ambiguous ? "launch sent but not confirmed: reconcile by hand before retrying" : `launch failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
    return { ok: false as const, status: 502, error: ambiguous ? "The launch was sent but not confirmed. We will check it; do not retry yet." : "Launch failed before anything was sent. You can retry." };
  }
  // The token exists now. Record it, retrying a flaky backend.
  for (let i = 0; ; i++) {
    try {
      await client.mutation(api.launch.recordLaunch, { secret, slug: id, mint: r.mint, metadataUri: r.metadataUri, sig: r.sig });
      break;
    } catch (e) {
      if (i >= 4) {
        console.error(`RECONCILE: launch agent ${id} minted ${r.mint} (sig ${r.sig}) but it could not be recorded`, e);
        return { ok: false as const, status: 500, error: `Your token was created (${r.mint}) but we could not save it. Do not retry; contact support with this address.` };
      }
      await new Promise((ok) => setTimeout(ok, 300 * 2 ** i));
    }
  }
  return { ok: true as const, mint: r.mint, sig: r.sig };
}
