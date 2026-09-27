/**
 * Mimir Market-Creator Agent — Solana edition
 *
 * Every cycle it drafts two kinds of short-horizon claims, stakes USDC on each,
 * creates them on-chain and delegates each to the MagicBlock Ephemeral Rollup
 * so challenges are real-time and fee-less:
 *
 *   1. CRYPTO  — price claims around the live Flash Trade spot (BTC/ETH/SOL).
 *                Resolution evidence: https://flashapi.trade/prices/<SYMBOL>.
 *   2. WORLD CUP — 2026 tournament markets (match results, goal totals, star
 *                  players to score). Resolution evidence: a web search the
 *                  oracle scrapes after the deadline.
 *
 * Run: npx tsx --env-file-if-exists=.env.local agents/market-creator/solana.ts
 * Env: SOLANA_KEYPAIR / CREATOR_KEYPAIR_JSON, SOLANA_USDC_MINT, program id
 *      CREATOR_INTERVAL_MS    (default 3_600_000 = 1h)
 *      CREATOR_CRYPTO_PER_RUN (default 2)
 *      CREATOR_WORLDCUP_PER_RUN (default 3)
 *      CREATOR_STAKE_USDC     (default 3)
 *      CREATOR_HORIZON_MIN    (claim deadline horizon in minutes, default 30)
 */
import { getAccount } from "@solana/spl-token";
import { loadCreatorKeypair } from "../../lib/solana/keypair";
import { MimirSolanaClient } from "../../lib/solana/client";
import { toUsdcUnits, ST_OPEN } from "../../lib/solana/config";
import {
  FLASH_CLAIM_SYMBOLS,
  flashResolutionUrl,
  getFlashPrice,
} from "../../lib/solana/flashtrade";
import { draftWorldCupClaims } from "../../lib/solana/worldcup";
import { isPaused } from "../../lib/ops/flags";
import { reportingPoll } from "../../lib/ops/heartbeat";

const INTERVAL_MS = Number(process.env.CREATOR_INTERVAL_MS ?? "3600000");
const CRYPTO_PER_RUN = Number(process.env.CREATOR_CRYPTO_PER_RUN ?? "2");
const WORLDCUP_PER_RUN = Number(process.env.CREATOR_WORLDCUP_PER_RUN ?? "3");
const STAKE_USDC = Number(process.env.CREATOR_STAKE_USDC ?? "3");
const HORIZON_MIN = Number(process.env.CREATOR_HORIZON_MIN ?? "30");

const SYMBOL_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
};

/** A chain-ready claim draft, regardless of theme. */
interface DraftClaim {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  category: string;
  resolutionUrl: string;
  label: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Crypto price claims around the live Flash Trade spot, ±0.3%. */
async function draftCryptoClaims(count: number): Promise<DraftClaim[]> {
  const out: DraftClaim[] = [];
  for (const symbol of FLASH_CLAIM_SYMBOLS) {
    if (out.length >= count) break;
    try {
      const px = await getFlashPrice(symbol);
      const direction = Math.random() < 0.5 ? "above" : "below";
      const skew = direction === "above" ? 1.003 : 0.997;
      const threshold = round2(px.priceUi * skew);
      const name = SYMBOL_NAMES[symbol] ?? symbol;
      out.push({
        label: `${symbol} ${direction} $${fmt(threshold)}`,
        category: "crypto",
        question: `Will ${name} (${symbol}) trade ${direction} $${fmt(threshold)} at the deadline, per the Flash Trade oracle price?`,
        creatorPosition: `Yes — ${symbol} will be ${direction} $${fmt(threshold)}`,
        counterPosition: `No — ${symbol} will not be ${direction} $${fmt(threshold)}`,
        resolutionUrl: flashResolutionUrl(symbol),
      });
    } catch (err: any) {
      console.warn(`[draft] ${symbol} price fetch failed:`, err?.message ?? err);
    }
  }
  return out;
}

/**
 * Cancel the creator's own claims that expired without ever drawing a
 * challenger. They can't be resolved (no winning side), so they'd otherwise
 * sit dead in the arena with the creator's stake locked. Cancelling refunds
 * the stake — undelegate first since the claim PDA lives in the ER.
 */
async function cancelExpiredEmpty(client: MimirSolanaClient): Promise<void> {
  const cfg = await client.getConfig();
  if (!cfg) return;
  const now = Math.floor(Date.now() / 1000);
  for (let id = 1n; id <= cfg.claimCount; id++) {
    const c = await client.getClaim(id);
    if (!c) continue;
    if (c.state !== ST_OPEN || c.deadline > now || c.challengers.length > 0) continue;
    if (!c.creator.equals(client.publicKey)) continue;
    try {
      if (await client.isDelegated(id)) {
        await client.undelegateClaim(id);
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          if (!(await client.isDelegated(id))) break;
        }
      }
      await client.cancelClaim(id);
      console.log(`[creator] cancelled expired empty claim #${id} — stake refunded`);
    } catch (err: any) {
      console.warn(`[creator] cancel #${id} failed:`, err?.message ?? err);
    }
  }
}

async function runCycle(client: MimirSolanaClient): Promise<void> {
  console.log(`\n[creator] ── Cycle at ${new Date().toISOString()}`);

  // Clean up dead expired claims first (frees the arena + refunds stake).
  await cancelExpiredEmpty(client);

  // Cancelling above returns stake, so it runs even while creation is paused.
  if (isPaused("create_market")) {
    console.log("[creator] Market creation paused (MIMIR_PAUSE_CREATE_MARKET) — skipping drafts.");
    return;
  }

  const [crypto, worldCup] = await Promise.all([
    draftCryptoClaims(CRYPTO_PER_RUN),
    Promise.resolve(draftWorldCupClaims(WORLDCUP_PER_RUN)),
  ]);
  const drafts: DraftClaim[] = [...worldCup, ...crypto];

  if (!drafts.length) {
    console.log("[creator] No drafts this cycle.");
    return;
  }

  // Guard: the creator stakes USDC on every claim and usually loses it to the
  // challengers, so its token account drains over time. Skip the cycle (rather
  // than spamming failed transactions) when it can't cover the drafts.
  const needed = STAKE_USDC * drafts.length;
  let usdcBal = 0;
  try {
    const acc = await getAccount(client.baseConnection, client.usdcAta());
    usdcBal = Number(acc.amount) / 1e6;
  } catch {
    usdcBal = 0;
  }
  if (usdcBal < needed) {
    console.log(
      `[creator] insufficient USDC (${usdcBal.toFixed(2)} < ${needed} needed) — ` +
        `top up ${client.publicKey.toBase58()} (faucet.circle.com or admin transfer). Skipping cycle.`
    );
    return;
  }

  for (const d of drafts) console.log(`[draft] ${d.category}: ${d.label}`);

  const deadline = Math.floor(Date.now() / 1000) + HORIZON_MIN * 60;
  for (const d of drafts) {
    try {
      const { txSig, claimId } = await client.createClaim({
        question: d.question,
        creatorPosition: d.creatorPosition,
        counterPosition: d.counterPosition,
        resolutionUrl: d.resolutionUrl,
        category: d.category,
        stakeAmount: toUsdcUnits(STAKE_USDC),
        deadline,
        maxChallengers: 16,
      });
      console.log(
        `[creator] ✓ Claim #${claimId} [${d.category}] ${d.label} — ` +
          `https://explorer.solana.com/tx/${txSig}?cluster=devnet`
      );
      // Hand the market to the Ephemeral Rollup right away: from here on,
      // every challenge is a zero-fee, ~30ms ER transaction.
      const delSig = await client.delegateClaim(claimId);
      console.log(`[creator]   → delegated to MagicBlock ER (${delSig.slice(0, 16)}…)`);
    } catch (err: any) {
      console.error(`[creator] Failed to create claim (${d.label}):`, err?.message ?? err);
    }
  }
}

async function main(): Promise<void> {
  const keypair = loadCreatorKeypair();
  const client = new MimirSolanaClient(keypair);
  const cfg = await client.getConfig();

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Market-Creator — crypto + World Cup 2026");
  console.log(`  Program  : ${client.base.programId.toBase58()}`);
  console.log(`  Creator  : ${client.publicKey.toBase58()}`);
  console.log(`  Claims   : ${cfg?.claimCount ?? "config missing!"}`);
  console.log(
    `  Cadence  : every ${INTERVAL_MS / 60000} min · ${CRYPTO_PER_RUN} crypto + ${WORLDCUP_PER_RUN} World Cup/run`
  );
  console.log(`  Stake    : ${STAKE_USDC} USDC · horizon ${HORIZON_MIN} min`);
  console.log("═══════════════════════════════════════════════\n");

  // Heartbeat + MIMIR_PAUSE_MARKET_CREATOR_WORKER + no overlapping cycles.
  const tick = reportingPoll("market_creator", INTERVAL_MS, () => runCycle(client));
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  console.error("[creator] Fatal:", err);
  process.exit(1);
});
