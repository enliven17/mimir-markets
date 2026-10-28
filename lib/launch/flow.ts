/**
 * Mimir Launch: launching an agent, in two calls (ported from snipad lib/server/launch.ts). Three venues:
 *   solana     (the default) a pump.fun token, trading on Solana: the flow below;
 *   robinhood  a Pons token, trading on Robinhood Chain: the same two calls with a Privy EVM wallet, funded in ETH
 *              from the owner's own Robinhood address (`payout`, where a shutdown pays back);
 *   arc        no token and no trading wallet: only Arc markets; it is live as soon as it is created.
 *   1. create(): validate the owner's form, check a BYOK key with one tiny call, make the agent's two wallets
 *      (Solana: Privy, policy-locked to trading + SOL back to the owner/treasury; Arc: a Circle wallet) and store it pending.
 *   2. launch(): the owner has sent the seed SOL to the Solana wallet; verify it on chain, then the agent wallet mints
 *      its token on pump.fun as creator and the agent goes live.
 *   2b. launchArc(): the Argus path (chain "arc"): no SOL step; the owner tops up the agent's Arc wallet with USDC for gas,
 *      and the agent wallet launches its token on Argus (lib/launch/argus.ts) as creator.
 * State lives in Convex (convex/launch.ts); chain work happens here. Dependencies are injected for tests.
 */
import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { AVATAR_SEED_RE } from "@/lib/avatar/spec";
import { BYOK_PROVIDERS, sealKey, type ByokProvider } from "./byok";
import { Trading, Markets } from "./inputs";
import { DEFAULT_MARKET_RULES } from "./markets";
import { allocationProblem, DEFAULT_ALLOCATION } from "./fees";
import { ARGUS, launchParams, type ArgusLaunched, type ArgusParams } from "./argus";
import type { verifyFunding } from "./funding";
import type { Cx } from "./request";
import { reservedLaunchSlug } from "./copy-key";
import type { verifyRobinhoodFunding } from "./robinhood/funding";

/** pump.fun create + rent + priority, paid by the agent wallet (~0.006 SOL measured in snipad); the rest is bankroll. */
export const LAUNCH_FEE_LAMPORTS = 10_000_000n;
/** Meteora DBC create: rent for the mint, pool, two vaults and metadata, plus priority (~0.03 SOL, rounded up). */
export const METEORA_LAUNCH_FEE_LAMPORTS = 40_000_000n;
/** Pons's launch fee (0.0005 ETH, read 2026-10-19) plus gas headroom for the launch and the first approvals, in wei. */
export const RH_LAUNCH_FEE_WEI = 1_000_000_000_000_000n; // 0.001 ETH
/** Convex documents are capped at 1 MB: an uploaded image stays well under it. */
const MAX_IMAGE_CHARS = 700_000;

const pctInt = z.number().int().min(0).max(100);
/** The owner's split of its 80% of every creator-fee claim: whole percents summing to 100. */
export const AllocationBody = z
  .object({ bankroll: pctInt, buyback: pctInt, creatorPayout: pctInt, holders: pctInt })
  .strict()
  .refine((a) => allocationProblem(a) === null, { message: "The four fee buckets must add up to 100." });

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
  /** Robinhood only: the owner's own Robinhood Chain address (it funds the launch and gets the ETH back). */
  payout: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  // 0 is fine: it launches on the launch fee alone and trades nothing until topped up. SOL, or ETH on Robinhood.
  seedSol: z.number().min(0).max(100),
  /** Where the owner's 80% of every creator-fee claim goes (lib/launch/fees.ts). */
  allocation: AllocationBody.default(DEFAULT_ALLOCATION),
  /** pump.fun on Solana, Argus on Arc (a taxed token: each side 0 to 10%, not both 0), or Pons on Robinhood Chain. */
  chain: z.enum(["solana", "arc", "robinhood"]).default("solana"),
  /** Solana only: pump.fun, or Meteora DBC on Mimir's own curve config. */
  pad: z.enum(["pump", "meteora"]).default("pump"),
  argus: z.object({ buyTaxBps: z.number().int().min(0).max(ARGUS.maxTaxBps), sellTaxBps: z.number().int().min(0).max(ARGUS.maxTaxBps) }).strict().optional(),
})
  .refine((b) => b.trading.enabled || b.markets.enabled || b.markets.create.enabled, { message: "Turn on markets, trading or both.", path: ["markets"] })
  .refine((b) => b.chain !== "arc" || (b.argus !== undefined && b.argus.buyTaxBps + b.argus.sellTaxBps > 0), { message: "An Argus token needs a buy or sell tax above 0.", path: ["argus"] })
  .refine((b) => b.chain !== "arc" || b.allocation.holders === 0, { message: "Holder airdrops are not available on Argus yet: set holders to 0.", path: ["allocation"] })
  // Solana trading runs on the seed SOL, which an Argus launch does not ask for.
  .refine((b) => b.chain !== "arc" || !b.trading.enabled, { message: "Solana trading needs a pump.fun launch; an Argus agent stakes on Arc markets.", path: ["trading"] })
  .refine((b) => b.chain !== "robinhood" || b.payout, { message: "Connect your Robinhood wallet: it funds the agent and gets its ETH back.", path: ["payout"] })
  .refine((b) => b.chain !== "robinhood" || !b.trading.enabled || !b.trading.strategy.sources.some((s) => s === "helius" || s === "x" || s === "birdeye"), { message: "On Robinhood Chain the agent reads Pons launches and graduated pools only.", path: ["trading"] });
export type CreateInput = z.infer<typeof CreateBody>;

export interface Wallets {
  /** The Solana wallet, policy-locked so SOL can only go back to `owner` (or the treasury). */
  solana: (owner: string) => Promise<{ id: string; address: string }>;
  /** The Robinhood Chain wallet, policy-locked so ETH can only go back to `payout` (or the treasury). */
  robinhood?: (payout: string) => Promise<{ id: string; address: string }>;
  arc: (slug: string) => Promise<{ id: string; address: string }>;
}
export type KeyCheck = (provider: ByokProvider, apiKey: string, model: string) => Promise<"ok" | "bad-key" | "busy">;
export type Launcher = (a: { walletId: string; wallet: string; name: string; symbol: string; description: string; imageDataUrl: string; devBuyLamports: bigint; pad?: "pump" | "meteora" }) => Promise<{ mint: string; sig: string; metadataUri: string }>;
/** Robinhood: pin the image, then launch on Pons from the agent's wallet. */
export type RhLauncher = (a: { walletId: string; wallet: string; name: string; symbol: string; description: string; imageDataUrl: string }) => Promise<{ mint: string; sig: string; metadataUri: string }>;
type Verify = typeof verifyFunding;

export async function create({ client, secret }: Cx, deps: { wallets: Wallets; checkKey: KeyCheck }, owner: string, input: CreateInput) {
  const slug = input.ticker.toLowerCase();
  // A persona's or a house name would share a council agent's page and its copy followers: refused before anything is made.
  if (reservedLaunchSlug(slug)) return { ok: false as const, status: 409, error: `$${input.ticker} belongs to Mimir's own agents. Pick another ticker.` };
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
  const { enabled, budgetUsdc, create: opens, ...rules } = input.markets;
  const venue = input.chain;
  if (venue === "robinhood" && !deps.wallets.robinhood) return { ok: false as const, status: 503, error: "Robinhood agents are not configured on this server." };
  const meteora = venue === "solana" && input.pad === "meteora";
  if (meteora && !process.env.LAUNCH_METEORA_CONFIG?.trim()) return { ok: false as const, status: 503, error: "Meteora launches are not configured on this server yet." };
  const payout = input.payout ? getAddress(input.payout) : null;
  // A Robinhood agent trades from its EVM wallet only; pump.fun and Argus agents keep the Solana wallet as before.
  const solana = venue !== "robinhood" ? await deps.wallets.solana(owner) : null;
  const robinhood = venue === "robinhood" && payout && deps.wallets.robinhood ? await deps.wallets.robinhood(payout) : null;
  const arc = await deps.wallets.arc(slug);
  const arcLaunch = venue === "arc";
  // What the owner sends before launch, in the chain's base unit: lamports, or wei on Robinhood. Argus asks for USDC gas instead.
  const fundLamports =
    venue === "robinhood" ? BigInt(Math.round(input.seedSol * 1e9)) * 1_000_000_000n + RH_LAUNCH_FEE_WEI
    : arcLaunch ? 0n
    : BigInt(Math.round(input.seedSol * 1e9)) + (meteora ? METEORA_LAUNCH_FEE_LAMPORTS : LAUNCH_FEE_LAMPORTS);
  const r = await client.mutation(api.launch.createPending, {
    secret, slug, uid, owner, name: input.name, ticker: input.ticker, avatarSeed: input.avatarSeed ?? slug, thesis: input.thesis, brain, trading,
    markets: { enabled, budgetUsdc, rules: { ...DEFAULT_MARKET_RULES, ...rules }, create: opens },
    ...(venue === "robinhood" ? { venue } : {}),
    ...(solana ? { solana: { walletId: solana.id, address: solana.address } } : {}),
    ...(robinhood && payout ? { robinhood: { walletId: robinhood.id, address: robinhood.address, payout } } : {}),
    arc: { walletId: arc.id, address: arc.address },
    fundLamports: fundLamports.toString(), description: input.description, ...(input.image ? { image: input.image } : {}),
    allocation: input.allocation,
    ...(arcLaunch ? { chain: "arc" as const, argus: input.argus } : {}),
    ...(meteora ? { pad: "meteora" as const } : {}),
  });
  // Lost a race for the ticker after the wallets were made: they are simply never funded.
  if (!r.ok) return { ok: false as const, status: 409, error: r.reason === "reserved" ? `$${input.ticker} belongs to Mimir's own agents. Pick another ticker.` : `Too many agents named $${input.ticker}. Pick another ticker.` };
  return { ok: true as const, id: r.slug, chain: input.chain, solana: solana?.address ?? null, robinhood: robinhood?.address ?? null, arc: arc.address, fundLamports, fundArcWei: arcLaunch ? ARGUS.launchGasWei : 0n };
}

type VerifyRh = typeof verifyRobinhoodFunding;

export async function launch(
  { client, secret }: Cx,
  deps: {
    verify: Verify; conn: Parameters<Verify>[0]; launchToken: Launcher; image: (avatarSeed: string) => Promise<string>;
    /** Robinhood agents only (built lazily by the route, so a Solana launch never needs the EVM layer). */
    robinhood?: () => { verify: VerifyRh; client: Parameters<VerifyRh>[0]; launchToken: RhLauncher };
  },
  owner: string,
  id: string,
  fundingSig: string,
) {
  const a = await client.query(api.launch.forLaunch, { secret, slug: id });
  const rh = a?.venue === "robinhood" ? a.robinhood : null;
  const wallet = rh ?? a?.solana;
  if (!a || a.owner !== owner || !wallet || !a.launch) return { ok: false as const, status: 404, error: "No such agent." };
  if (a.mint) return { ok: true as const, mint: a.mint }; // already launched: idempotent
  if (a.launch.chain === "arc") return { ok: false as const, status: 409, error: "This agent launches on Argus." };
  if (a.status !== "pending") return { ok: false as const, status: 409, error: `Agent is ${a.status}.` };
  const rhDeps = rh ? deps.robinhood?.() : undefined;
  if (rh && !rhDeps) return { ok: false as const, status: 503, error: "Robinhood launches are not configured on this server." };
  const funded = rh && rhDeps
    ? await rhDeps.verify(rhDeps.client, { hash: fundingSig, from: rh.payout, to: rh.address, minWei: BigInt(a.launch.fundLamports) })
    : await deps.verify(deps.conn, { sig: fundingSig, from: owner, to: wallet.address, minLamports: BigInt(a.launch.fundLamports) });
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
  if (claim === "sig-used") return { ok: false as const, status: 409, error: "That funding transaction was already used for another agent. Send the funds in a new transaction." };
  if (!claim) return { ok: false as const, status: 409, error: "Launch already in progress." };
  // Only the chain call is in this try: once a mint exists, nothing may release the claim.
  let r: Awaited<ReturnType<Launcher>>;
  try {
    const token = { walletId: wallet.walletId, wallet: wallet.address, name: a.name, symbol: a.ticker, description: a.launch.description, imageDataUrl };
    r = rhDeps ? await rhDeps.launchToken(token) : await deps.launchToken({ ...token, devBuyLamports: 0n, pad: a.launch.pad ?? "pump" });
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

export type ArgusLauncher = (a: { walletId: string; wallet: string; uid: string; params: ArgusParams }) => Promise<ArgusLaunched & { tx: string | null }>;

/**
 * Step 2 of an Argus launch: the agent's Arc wallet must hold the launch gas (ARGUS.launchGasWei); then the image is
 * pinned and the wallet launches. A failed send always releases the claim: a retry is safe because the token address
 * is fixed per agent, so a launch that did land is recovered (lib/launch/argus-chain.ts sendLaunch), never repeated.
 */
export async function launchArc(
  { client, secret }: Cx,
  deps: { balanceWei: (address: string) => Promise<bigint>; image: (avatarSeed: string) => Promise<string>; pin: (dataUrl: string, name: string) => Promise<string>; launchToken: ArgusLauncher },
  owner: string,
  id: string,
) {
  const a = await client.query(api.launch.forLaunch, { secret, slug: id });
  if (!a || a.owner !== owner || !a.arc || !a.launch) return { ok: false as const, status: 404, error: "No such agent." };
  if (a.token) return { ok: true as const, token: a.token.address, poolId: a.token.poolId };
  if (a.launch.chain !== "arc" || !a.launch.argus) return { ok: false as const, status: 409, error: "This agent launches on pump.fun." };
  if (a.status !== "pending") return { ok: false as const, status: 409, error: `Agent is ${a.status}.` };
  const balance = await deps.balanceWei(a.arc.address);
  if (balance < ARGUS.launchGasWei) return { ok: false as const, status: 402, error: `Send at least ${Number(ARGUS.launchGasWei / 10n ** 12n) / 1e6} USDC to the agent's Arc wallet for the launch gas, then try again.` };
  let params: ArgusParams, imageURI: string;
  try {
    imageURI = await deps.pin(a.launch.image ?? (await deps.image(a.avatarSeed)), `${a.ticker}.png`);
    params = launchParams({
      name: a.name, symbol: a.ticker, description: a.launch.description, imageURI, ...a.launch.argus,
      split: a.allocation ?? DEFAULT_ALLOCATION, devBuyUsdc6: 0n,
    });
  } catch (e) {
    console.error("argus launch prep:", e);
    return { ok: false as const, status: 500, error: "Could not prepare the token image. Try again." };
  }
  const claim = await client.mutation(api.launch.claimLaunch, { secret, slug: id });
  if (claim !== true) return { ok: false as const, status: 409, error: "Launch already in progress." };
  let r: Awaited<ReturnType<ArgusLauncher>>;
  try {
    r = await deps.launchToken({ walletId: a.arc.walletId, wallet: a.arc.address, uid: a.uid, params });
  } catch (e) {
    await client.mutation(api.launch.releaseLaunch, { secret, slug: id });
    await client.mutation(api.launch.logEvent, { secret, slug: id, kind: "error", text: `Argus launch failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
    return { ok: false as const, status: 502, error: "The launch did not go through. Retrying is safe: a token that did launch is picked up, never made twice." };
  }
  const token = { address: r.token, poolId: r.poolId, splitter: r.splitter, hook: r.hook, locker: r.locker, creatorBps: params.p.creatorBps, ...(r.tx ? { tx: r.tx } : {}) };
  for (let i = 0; ; i++) {
    try {
      await client.mutation(api.launch.recordArgusLaunch, { secret, slug: id, token });
      break;
    } catch (e) {
      if (i >= 4) {
        console.error(`RECONCILE: launch agent ${id} launched ${r.token} on Argus (tx ${r.tx}) but it could not be recorded`, e);
        return { ok: false as const, status: 500, error: `Your token was created (${r.token}) but we could not save it. Do not retry; contact support with this address.` };
      }
      await new Promise((ok) => setTimeout(ok, 300 * 2 ** i));
    }
  }
  return { ok: true as const, token: r.token, poolId: r.poolId };
}
