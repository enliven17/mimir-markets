/**
 * Mimir Market-Creator Agent — Solana edition
 *
 * Every cycle it drafts short-horizon claims from sources that can settle
 * them, scores each on decidability, drops duplicates of joinable claims,
 * stakes USDC on the rest, creates them on-chain and delegates each to the
 * MagicBlock Ephemeral Rollup so challenges are real-time and fee-less:
 *
 *   1. CRYPTO     — price claims around the live Flash Trade spot (BTC/ETH/SOL)
 *                   with a deterministic price resolver in the URL fragment.
 *   2. SPORTS     — scheduled World Cup / Premier League / Champions League /
 *                   NFL / NBA games from ESPN, betting closes at kickoff.
 *   3. STOCKS     — large-cap day direction, read off stockanalysis.com.
 *   4. POLYMARKET — live, contested binary markets (MARKET_CREATOR_POLYMARKET=1);
 *                   the oracle waits for the UMA resolution before settling.
 *
 * Every draft here is built from live source data by rule, not written by a
 * model: the thresholds, teams, dates and URLs come from the source itself,
 * which is the whole point of the source's allowlist checks.
 *
 * Run: npm run market-creator:solana [-- --dry-run] [-- --once]
 *   --dry-run (or MARKET_CREATOR_DRY_RUN=1): draft, score and log only; no
 *             cancels, claims, stakes or delegations.
 *   --once:   one cycle, then exit.
 * Env: SOLANA_KEYPAIR / CREATOR_KEYPAIR_JSON, SOLANA_USDC_MINT, program id
 *      CREATOR_INTERVAL_MS       (default 3_600_000 = 1h)
 *      CREATOR_CRYPTO_PER_RUN    (default 2)
 *      CREATOR_SPORTS_PER_RUN    (default 3; falls back to CREATOR_WORLDCUP_PER_RUN)
 *      CREATOR_STOCKS_PER_RUN    (default 1)
 *      CREATOR_POLYMARKET_PER_RUN (default 2, only with MARKET_CREATOR_POLYMARKET=1)
 *      CREATOR_STAKE_USDC        (default 3)
 *      CREATOR_HORIZON_MIN       (crypto deadline horizon in minutes, default 30)
 *      CREATOR_SPORTS_MAX_HOURS  (latest kickoff drafted, default 72)
 *      CREATOR_MIN_QUALITY       (decidability score floor 0-100, default 60)
 *      MAX_ACTIVE_CLAIMS         (skip drafting when this many are joinable, default 30)
 *      MARKET_CREATOR_PREFLIGHT=1 (council personas vet each draft first; low scores are dropped)
 *      MARKET_CREATOR_PREFLIGHT_MIN_SCORE (default 60)
 *      MARKET_CREATOR_PREFLIGHT_PERSONAS  (CSV, default socrates,aurelius,statistician)
 */
import { getAccount } from "@solana/spl-token";
import { loadCreatorKeypair } from "../../lib/solana/keypair";
import { MimirSolanaClient } from "../../lib/solana/client";
import { toUsdcUnits } from "../../lib/solana/config";
import { isPaused } from "../../lib/ops/flags";
import { reportingPoll } from "../../lib/ops/heartbeat";
import { gatherCouncilPreflight, preflightKeeps, preflightPersonas } from "./council-preflight";
import { draftProblem, scoreDraft, type DraftClaim } from "./draft";
import { draftCryptoClaims } from "./crypto";
import { draftSportsClaims } from "./sports";
import { draftStockClaims } from "./stocks";
import { fetchPolymarketCandidates, isPolymarketEnabled, polymarketDraft } from "./polymarket";
import { filterDuplicates } from "./dedupe";
import { cancelExpiredEmpty, summarizeInventory } from "./inventory";

const envNum = (name: string, fallback: string) => Number(process.env[name] ?? fallback);

const INTERVAL_MS = envNum("CREATOR_INTERVAL_MS", "3600000");
const CRYPTO_PER_RUN = envNum("CREATOR_CRYPTO_PER_RUN", "2");
const SPORTS_PER_RUN = Number(process.env.CREATOR_SPORTS_PER_RUN ?? process.env.CREATOR_WORLDCUP_PER_RUN ?? "3");
const STOCKS_PER_RUN = envNum("CREATOR_STOCKS_PER_RUN", "1");
const POLYMARKET_PER_RUN = envNum("CREATOR_POLYMARKET_PER_RUN", "2");
const STAKE_USDC = envNum("CREATOR_STAKE_USDC", "3");
const HORIZON_MIN = envNum("CREATOR_HORIZON_MIN", "30");
const SPORTS_MAX_HOURS = envNum("CREATOR_SPORTS_MAX_HOURS", "72");
const MIN_QUALITY = envNum("CREATOR_MIN_QUALITY", "60");
const MAX_ACTIVE_CLAIMS = envNum("MAX_ACTIVE_CLAIMS", "30");
const PREFLIGHT = process.env.MARKET_CREATOR_PREFLIGHT === "1";
const PREFLIGHT_MIN_SCORE = envNum("MARKET_CREATOR_PREFLIGHT_MIN_SCORE", "60");
const PREFLIGHT_GAP_MS = 4_000;
const DRY_RUN = process.argv.includes("--dry-run") || process.env.MARKET_CREATOR_DRY_RUN === "1";
const ONCE = process.argv.includes("--once");

/** Drop drafts the council scores low (MARKET_CREATOR_PREFLIGHT=1). Unavailable council → keep. */
async function vetDrafts(drafts: DraftClaim[]): Promise<DraftClaim[]> {
  if (!PREFLIGHT || drafts.length === 0) return drafts;
  const personas = preflightPersonas(process.env.MARKET_CREATOR_PREFLIGHT_PERSONAS);
  const kept: DraftClaim[] = [];
  for (const d of drafts) {
    const result = await gatherCouncilPreflight({
      candidate: {
        question: d.question,
        creatorPosition: d.creatorPosition,
        counterPosition: d.counterPosition,
        resolutionUrl: d.resolutionUrl,
        category: d.category,
        settlementRule: d.settlementRule,
        deadlineHours: Math.max(0, (d.deadline * 1000 - Date.now()) / 3_600_000),
      },
      personas,
      sequentialGapMs: PREFLIGHT_GAP_MS,
    }).catch(() => null);
    const keep = !result || preflightKeeps(result, PREFLIGHT_MIN_SCORE);
    console.log(
      `[creator] preflight ${result?.averageScore ?? "n/a"}/100 ` +
        `(open=${result?.openVotes ?? 0} revise=${result?.reviseVotes ?? 0} skip=${result?.skipVotes ?? 0}) ` +
        `${keep ? "keep" : "DROP"}: ${d.label}`,
    );
    if (keep) kept.push(d);
  }
  return kept;
}

/** Everything the sources offer this cycle, before any filtering. */
async function gatherDrafts(): Promise<DraftClaim[]> {
  const [crypto, sports, polymarket] = await Promise.all([
    draftCryptoClaims(CRYPTO_PER_RUN, HORIZON_MIN),
    draftSportsClaims(SPORTS_PER_RUN, SPORTS_MAX_HOURS),
    isPolymarketEnabled() && POLYMARKET_PER_RUN > 0 ? fetchPolymarketCandidates() : Promise.resolve([]),
  ]);
  const stocks = draftStockClaims(STOCKS_PER_RUN);
  const borrowed = polymarket
    .map(polymarketDraft)
    .filter((d): d is DraftClaim => d !== null)
    .slice(0, POLYMARKET_PER_RUN);
  console.log(
    `[creator] sources: crypto=${crypto.length} sports=${sports.length} stocks=${stocks.length} ` +
      `polymarket=${borrowed.length}${isPolymarketEnabled() ? "" : " (off)"}`,
  );
  return [...sports, ...borrowed, ...stocks, ...crypto];
}

/** Chain limits and the decidability floor; logs every drop and every score. */
function gateDrafts(drafts: DraftClaim[]): DraftClaim[] {
  const kept: DraftClaim[] = [];
  for (const d of drafts) {
    const problem = draftProblem(d);
    if (problem) {
      console.warn(`[draft] drop (${problem}): ${d.label}`);
      continue;
    }
    const q = scoreDraft(d);
    const failed = q.signals.filter((s) => !s.passed).map((s) => s.key);
    if (q.score < MIN_QUALITY) {
      console.warn(`[draft] drop (quality ${q.score} < ${MIN_QUALITY}; ${failed.join(", ")}): ${d.label}`);
      continue;
    }
    console.log(`[draft] ${d.source}/${d.category} q=${q.score}${failed.length ? ` (-${failed.join(",")})` : ""}: ${d.label}`);
    kept.push(d);
  }
  return kept;
}

async function usdcBalance(client: MimirSolanaClient): Promise<number> {
  try {
    const acc = await getAccount(client.baseConnection, client.usdcAta());
    return Number(acc.amount) / 1e6;
  } catch {
    return 0;
  }
}

async function publish(client: MimirSolanaClient, d: DraftClaim): Promise<void> {
  try {
    const { txSig, claimId } = await client.createClaim({
      question: d.question,
      creatorPosition: d.creatorPosition,
      counterPosition: d.counterPosition,
      resolutionUrl: d.resolutionUrl,
      category: d.category,
      stakeAmount: toUsdcUnits(STAKE_USDC),
      deadline: d.deadline,
      maxChallengers: 16,
    });
    console.log(
      `[creator] ✓ Claim #${claimId} [${d.category}] ${d.label} — ` +
        `https://explorer.solana.com/tx/${txSig}?cluster=devnet`,
    );
    // Hand the market to the Ephemeral Rollup right away: from here on,
    // every challenge is a zero-fee, ~30ms ER transaction.
    const delSig = await client.delegateClaim(claimId);
    console.log(`[creator]   → delegated to MagicBlock ER (${delSig.slice(0, 16)}…)`);
  } catch (err: any) {
    console.error(`[creator] Failed to create claim (${d.label}):`, err?.message ?? err);
  }
}

async function runCycle(client: MimirSolanaClient): Promise<void> {
  console.log(`\n[creator] ── Cycle at ${new Date().toISOString()}${DRY_RUN ? " [dry run]" : ""}`);

  // One pass: cancel own dead claims (frees the arena + refunds stake), count
  // joinable inventory and collect signatures for the duplicate guard.
  const inventory = summarizeInventory(await client.getAllClaims(), client.publicKey);
  await cancelExpiredEmpty(client, inventory.expiredEmpty, DRY_RUN);

  // Cancelling above returns stake, so it runs even while creation is paused.
  if (isPaused("create_market")) {
    console.log("[creator] Market creation paused (MIMIR_PAUSE_CREATE_MARKET) — skipping drafts.");
    return;
  }
  // The program's admin pause rejects create_claim; don't burn source/LLM calls on drafts.
  if ((await client.getConfig())?.paused) {
    console.log("[creator] Program is PAUSED on-chain — skipping drafts.");
    return;
  }

  console.log(`[creator] joinable claims: ${inventory.joinable} (cap ${MAX_ACTIVE_CLAIMS})`);
  const headroom = MAX_ACTIVE_CLAIMS - inventory.joinable;
  if (headroom <= 0) {
    console.log("[creator] inventory at cap — skipping drafts.");
    return;
  }

  const unique = filterDuplicates(gateDrafts(await gatherDrafts()), inventory.signatures, (d, why) =>
    console.warn(`[draft] drop (duplicate, ${why}): ${d.label}`),
  );
  const drafts = (await vetDrafts(unique)).slice(0, headroom);
  if (!drafts.length) {
    console.log("[creator] No drafts this cycle.");
    return;
  }

  // Guard: the creator stakes USDC on every claim and usually loses it to the
  // challengers, so its token account drains over time. Skip the cycle (rather
  // than spamming failed transactions) when it can't cover the drafts.
  const needed = STAKE_USDC * drafts.length;
  const usdcBal = await usdcBalance(client);
  if (usdcBal < needed) {
    console.log(
      `[creator] insufficient USDC (${usdcBal.toFixed(2)} < ${needed} needed) — ` +
        `top up ${client.publicKey.toBase58()} (faucet.circle.com or admin transfer). ` +
        (DRY_RUN ? "Listing the drafts anyway (dry run)." : "Skipping cycle."),
    );
    if (!DRY_RUN) return;
  }

  for (const d of drafts) {
    if (DRY_RUN) {
      console.log(
        `[creator] (dry run) would create [${d.category}] "${d.question}" · deadline ${new Date(d.deadline * 1000).toISOString()} · ${d.resolutionUrl}`,
      );
      continue;
    }
    await publish(client, d);
  }
}

async function main(): Promise<void> {
  const keypair = loadCreatorKeypair();
  const client = new MimirSolanaClient(keypair);
  const cfg = await client.getConfig();

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Market-Creator — crypto · sports · stocks · polymarket");
  console.log(`  Program  : ${client.base.programId.toBase58()}`);
  console.log(`  Creator  : ${client.publicKey.toBase58()}`);
  console.log(`  Claims   : ${cfg?.claimCount ?? "config missing!"}`);
  console.log(
    `  Cadence  : every ${INTERVAL_MS / 60000} min · ${CRYPTO_PER_RUN} crypto + ${SPORTS_PER_RUN} sports + ` +
      `${STOCKS_PER_RUN} stocks${isPolymarketEnabled() ? ` + ${POLYMARKET_PER_RUN} polymarket` : ""}/run`,
  );
  console.log(`  Stake    : ${STAKE_USDC} USDC · crypto horizon ${HORIZON_MIN} min · quality ≥ ${MIN_QUALITY}`);
  console.log(`  Cap      : ${MAX_ACTIVE_CLAIMS} joinable claims${DRY_RUN ? " · DRY RUN" : ""}`);
  console.log("═══════════════════════════════════════════════\n");

  if (ONCE) {
    await runCycle(client);
    process.exit(0);
  }
  // Heartbeat + MIMIR_PAUSE_MARKET_CREATOR_WORKER + no overlapping cycles.
  const tick = reportingPoll("market_creator", INTERVAL_MS, () => runCycle(client));
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  console.error("[creator] Fatal:", err);
  process.exit(1);
});
