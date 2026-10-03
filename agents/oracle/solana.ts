/**
 * Mimir Oracle Agent: Solana × MagicBlock ER edition
 *
 * Roles:
 *   1. SETTLER:     when a claim's deadline passes: commit + undelegate it
 *                   from the Ephemeral Rollup and decide it (agents/oracle/decide.ts:
 *                   structured resolver → deadline prices + cross-check →
 *                   council jury or LLM → tiers), publish the verdict audit
 *                   bundle, then PROPOSE on the base layer with
 *                   evidence_hash = sha256(bundle) (V3 optimistic resolution).
 *                   After the dispute window: finalize, crank payouts; past
 *                   deadline + grace: refund_expired (agents/oracle/lifecycle.ts).
 *                   Honors the on-chain pause.
 *   2. CHALLENGER:  (AUTO_CHALLENGE=1) forecast open claims early (every
 *                   forecast is logged for /calibration) and stake on
 *                   mispriced ones INSIDE the ER (zero fee, ~30ms),
 *                   Kelly-sized, optionally hedged on Flash Trade perps.
 *
 * Run: npx tsx --env-file-if-exists=.env.local agents/oracle/solana.ts
 * Env: SOLANA_KEYPAIR (defaults to ~/.config/solana/talos-deploy.json)
 *      SOLANA_USDC_MINT, NEXT_PUBLIC_MIMIR_PROGRAM_ID
 *      ORACLE_GEMINI_API_KEY / ORACLE_ANTHROPIC_API_KEY (own quota; required on mainnet,
 *      where the shared keys are never used), SETTLEMENT_MODELS (lib/llm.ts)
 *      AUTO_CHALLENGE=1 (or MIMIR_FEATURE_AUTO_CHALLENGE=1; on mainnet also AUTO_CHALLENGE_MAINNET=1),
 *      CHALLENGE_STAKE_USDC, CHALLENGE_CONFIDENCE, CHALLENGE_MAX_CREATOR_MULTIPLE
 *      COUNCIL_SETTLEMENT=1 (council-as-jury), COUNCIL_SELF_RESOLVING=1, COUNCIL_QUORUM,
 *      COUNCIL_ALPHA, COUNCIL_BONUS_USDC
 *      MIMIR_PAUSE_ORACLE_SETTLEMENT=1 / MIMIR_PAUSE_AUTO_CHALLENGE=1 (pause switches)
 *      HEDGE_MODE=dry|live|off   (Flash Trade hedge; default dry, off on mainnet;
 *                                 live also needs HEDGE_ALLOW_UNMANAGED=1)
 *      ALERT_WEBHOOK_URL         (disputes and refused proposals)
 *      ORACLE_POLL_INTERVAL_MS   (default 30000)
 *      ORACLE_DRY_RUN=1          (decide + log only: no proposals, stakes or cranks)
 */
import { VersionedTransaction, type Keypair } from "@solana/web3.js";
import { loadAgentKeypair, loadCreatorPublicKey, loadHedgeKeypair, loadPersonaKeypair } from "../../lib/solana/keypair";
import { providerChain } from "../../lib/llm";
import { isFeatureEnabled, isPaused } from "../../lib/ops/flags";
import { reportingPoll } from "../../lib/ops/heartbeat";
import { challengerKellyStake } from "../../lib/kelly";
import { parseCouncilAddresses } from "../../lib/server/council-roster";
import {
  fetchEvidence as fetchEvidenceShared,
  type EvidenceFetcherKind,
} from "../../lib/server/evidence-fetcher";
import { MimirSolanaClient, type OnchainClaim } from "../../lib/solana/client";
import {
  toUsdcUnits,
  fromUsdcUnits,
  ST_OPEN,
  MIN_STAKE_UNITS,
  ST_ACTIVE,
  SIDE_CREATOR,
  SIDE_CHALLENGERS,
  SIDE_DRAW,
  SIDE_UNRESOLVABLE,
  IS_MAINNET,
  explorerUrl,
} from "../../lib/solana/config";
import { needsProposal } from "../../lib/solana/lifecycle";
import { effectiveResolverSpec, stripResolverFragment, winnerFor } from "../../lib/resolver-spec";
import { saveVerdictBundle } from "../../lib/server/verdict-bundles";
import { recordForecast } from "../../lib/server/forecasts";
import { probabilityFromVerdict } from "../../lib/calibration";
import { COUNCIL_PERSONAS } from "../council/personas";
import { advanceLifecycle } from "./lifecycle";
import { applyFetcherTrust, BROWSER_USER_AGENT, decide, type DecideContext, type JuryConfig, type SettlementDecision } from "./decide";
import { evaluateClaim, ORACLE_KEY_ENV, type OracleVerdict } from "./evaluate";
import { payCouncilBonuses } from "./council-vote";
import { autoChallengeEnabled, ClaimBackoff, parseHedgeMode } from "./policy";
import { alert } from "./alert";
import {
  planHedgeFromSpec,
  buildOpenPositionTx,
  getFlashPrice,
  verifyHedgeTx,
} from "../../lib/solana/flashtrade";

// ── Config ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = Number(process.env.ORACLE_POLL_INTERVAL_MS ?? "30000");
const AUTO_CHALLENGE = autoChallengeEnabled({
  requested: process.env.AUTO_CHALLENGE === "1" || isFeatureEnabled("auto_challenge"),
  mainnet: IS_MAINNET,
  mainnetOverride: process.env.AUTO_CHALLENGE_MAINNET === "1",
});
const CHALLENGE_STAKE_USDC = Number(process.env.CHALLENGE_STAKE_USDC ?? "2");
const CHALLENGE_CONFIDENCE = Number(process.env.CHALLENGE_CONFIDENCE ?? "80");
/** A challenge stake never exceeds this multiple of the creator's stake. */
const CHALLENGE_MAX_CREATOR_MULTIPLE = Number(process.env.CHALLENGE_MAX_CREATOR_MULTIPLE ?? "1");
// Throws at startup on anything but dry|live|off (and on live without HEDGE_ALLOW_UNMANAGED=1).
const HEDGE_MODE = parseHedgeMode(process.env.HEDGE_MODE, {
  mainnet: IS_MAINNET,
  allowUnmanaged: process.env.HEDGE_ALLOW_UNMANAGED === "1",
});
const DRY_RUN = process.env.ORACLE_DRY_RUN === "1";

// Council-as-jury settlement: off by default. Self-resolving mode scores
// jurors against the oracle's evidence-only reference report.
const COUNCIL_SETTLEMENT = process.env.COUNCIL_SETTLEMENT === "1" || isFeatureEnabled("council_settlement");
const COUNCIL_SELF_RESOLVING = COUNCIL_SETTLEMENT && process.env.COUNCIL_SELF_RESOLVING === "1";
const COUNCIL_QUORUM = Number(process.env.COUNCIL_QUORUM ?? "3");
const COUNCIL_ALPHA = Number(process.env.COUNCIL_ALPHA ?? "0.25");
const COUNCIL_BONUS_USDC = Number(process.env.COUNCIL_BONUS_USDC ?? "0");

const ORACLE_LLM_CHAIN = providerChain({ keyEnv: ORACLE_KEY_ENV, role: "oracle", settlement: true });
if (ORACLE_LLM_CHAIN.length === 0) {
  console.error(
    IS_MAINNET
      ? "The oracle needs its own key on mainnet: ORACLE_GEMINI_API_KEY or ORACLE_ANTHROPIC_API_KEY, with a SETTLEMENT_MODELS model"
      : "A settlement-grade LLM key is required (ORACLE_GEMINI_API_KEY / GEMINI_API_KEY or ANTHROPIC_API_KEY; Groq/OpenRouter never settle)"
  );
  process.exit(1);
}

const challengedClaimIds = new Set<string>();
const evaluatedClaimIds = new Set<string>();

async function fetchEvidence(url: string): Promise<{ text: string; fetcher: EvidenceFetcherKind | "none" }> {
  const target = stripResolverFragment(url ?? "");
  if (!target.startsWith("http")) return { text: "(No resolution URL provided)", fetcher: "none" };
  try {
    const snap = await fetchEvidenceShared(target, { maxChars: 8_000, userAgent: BROWSER_USER_AGENT });
    return { text: snap.text, fetcher: snap.fetcher };
  } catch (err: any) {
    return { text: `(Failed to fetch: ${err?.message ?? "unknown"})`, fetcher: "none" };
  }
}

function verdictToSide(verdict: OracleVerdict["verdict"]): number {
  switch (verdict) {
    case "CREATOR_WINS": return SIDE_CREATOR;
    case "CHALLENGERS_WIN": return SIDE_CHALLENGERS;
    case "DRAW": return SIDE_DRAW;
    case "UNRESOLVABLE": return SIDE_UNRESOLVABLE;
  }
}

/** The oracle never bets more than a quarter of its bankroll on one claim. */
const ORACLE_KELLY_CAP = 0.25;

/** Persona wallets: COUNCIL_ADDRESSES when set, else derived from the admin key as the council worker does. */
function personaAddresses(admin: Keypair): Map<string, string> {
  const known = parseCouncilAddresses(process.env.COUNCIL_ADDRESSES);
  const out = new Map<string, string>();
  for (const p of COUNCIL_PERSONAS) {
    const addr = typeof known?.[p.slug] === "string" ? known[p.slug] : loadPersonaKeypair(admin, p.slug).publicKey.toBase58();
    out.set(p.slug, addr);
  }
  return out;
}

/**
 * Every address the operator controls: the oracle, the market creator's
 * wallet, every council persona. decide() settles claims any of them holds a
 * position in on FIRM verdicts only.
 */
function houseAddresses(oracle: Keypair): Set<string> {
  const house = new Set<string>([oracle.publicKey.toBase58()]);
  try {
    house.add(loadCreatorPublicKey().toBase58());
  } catch (err) {
    // On mainnet an incomplete house set would let house-held claims settle on soft verdicts.
    if (IS_MAINNET) throw err;
    console.warn("[oracle] creator wallet unknown for the house check:", err instanceof Error ? err.message : err);
  }
  for (const addr of personaAddresses(oracle).values()) house.add(addr);
  return house;
}

/** Council jury wiring. */
function juryConfig(): JuryConfig | null {
  if (!COUNCIL_SETTLEMENT) return null;
  const wallets = personaAddresses(loadAgentKeypair());
  const slugByAddress = new Map<string, string>();
  for (const [slug, addr] of wallets) slugByAddress.set(addr, slug);
  return {
    quorum: COUNCIL_QUORUM,
    selfResolving: COUNCIL_SELF_RESOLVING ? { alpha: COUNCIL_ALPHA, minVotes: COUNCIL_QUORUM } : undefined,
    wallets,
    slugByAddress,
  };
}

// ── ROLE 1: settle ────────────────────────────────────────────────────────

/**
 * The decision for a claim whose propose write failed. A retry re-submits the
 * same verdict instead of re-fetching evidence and re-rolling a
 * non-deterministic LLM that might now answer differently.
 */
const decidedVerdicts = new Map<string, SettlementDecision>();
/** Claims whose propose write failed recently, keyed by id → retry-after ms. */
const settleBackoff = new Map<string, number>();
const SETTLE_RETRY_BACKOFF_MS = Number(process.env.ORACLE_SETTLE_RETRY_BACKOFF_MS ?? "120000");
/** Claims decide() said are not ready yet (not final, no evidence, no model): 5 min doubling to 1 h. */
const notReadyBackoff = new ClaimBackoff();

/** Returns "deferred" when decide() said the claim is not ready to settle yet. */
async function settle(client: MimirSolanaClient, ctx: DecideContext, claim: OnchainClaim): Promise<"done" | "deferred"> {
  console.log(`\n[settle] Claim #${claim.id}: "${claim.question.slice(0, 60)}..."`);
  const key = claim.id.toString();

  // Step 1: if the claim still lives in the ER, commit + undelegate it
  if (!DRY_RUN && (await client.isDelegated(claim.id))) {
    console.log("[settle] Claim is in the ER, committing + undelegating...");
    if (!(await client.ensureClaimOnBase(claim.id))) {
      throw new Error("claim is still delegated after undelegate, retry later");
    }
    console.log("[settle] Claim is back on the base layer");
  }

  // Step 2: decide, or re-use the decision of a failed earlier attempt.
  let decision = decidedVerdicts.get(key) ?? null;
  if (decision) {
    console.log("[settle] Re-submitting the verdict decided on an earlier attempt.");
  } else {
    decision = await decide(ctx, claim);
    if (!decision) return "deferred";
    decidedVerdicts.set(key, decision);
  }
  const { verdict, evidenceHash, bundle } = decision;
  const hashHex = Buffer.from(evidenceHash).toString("hex");
  console.log(`[settle] Verdict: ${verdict.verdict} (${verdict.confidence}%) · evidence_hash ${hashHex}`);

  if (DRY_RUN) {
    console.log(`[settle] DRY RUN: would propose side ${verdictToSide(verdict.verdict)}: "${verdict.explanation.slice(0, 120)}"`);
    decidedVerdicts.delete(key);
    return "done";
  }

  // Step 3: publish the audit bundle before committing its hash, so the
  // moment the proposal is on chain anyone can check what it rested on. No
  // stored bundle (or no store on mainnet), no proposal: the decision is kept
  // and re-submitted on a later poll.
  try {
    await saveVerdictBundle(bundle);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await alert(`Claim #${claim.id}: verdict bundle not stored (${msg}); not proposing, will retry`);
    throw new Error(`verdict bundle not stored: ${msg}`);
  }

  // Step 4: propose on the base layer. The claim may have moved on since the
  // scan, so re-read the base layer right before signing.
  const fresh = await client.getBaseClaim(claim.id);
  if (!fresh || fresh.state !== ST_ACTIVE) {
    console.log(`[settle] Claim #${claim.id} is no longer ACTIVE on the base layer, nothing to write.`);
    decidedVerdicts.delete(key);
    return "done";
  }
  const sig = await client.proposeResolution(
    claim.id,
    verdictToSide(verdict.verdict),
    verdict.explanation.slice(0, 300),
    verdict.confidence,
    evidenceHash
  );
  decidedVerdicts.delete(key);

  // Cross-entropy bonuses after the proposal: best-effort, never part of it.
  if (decision.bonusVotes && COUNCIL_BONUS_USDC > 0) {
    const receipts = await payCouncilBonuses(client.baseConnection, client.wallet.payer, decision.bonusVotes, COUNCIL_BONUS_USDC);
    for (const r of receipts) console.log(`[settle] Bonus ${r.bonusUsdc.toFixed(6)} USDC → ${r.slug}${r.sig ? ` (${r.sig.slice(0, 16)}…)` : " (failed)"}`);
  }

  if (fresh.disputeWindow > 0) {
    const until = new Date((Math.floor(Date.now() / 1000) + fresh.disputeWindow) * 1000).toISOString();
    console.log(`[settle] ✓ Proposed (disputable until ~${until}): ${explorerUrl("tx", sig)}`);
    return "done";
  }
  // Zero dispute window: the proposal settled immediately, crank payouts now.
  console.log(`[settle] ✓ Resolved (no dispute window): ${explorerUrl("tx", sig)}`);
  const { paid, failed } = await client.crankPayouts(claim.id);
  console.log(`[settle] ✓ ${paid} payout leg(s) cranked${failed.length ? `, ${failed.length} to retry` : ""}`);
  return "done";
}

// ── ROLE 2: challenge (inside the ER) ─────────────────────────────────────
let erReady = false;

async function ensureErStake(client: MimirSolanaClient): Promise<boolean> {
  if (erReady) return true;
  // Balance must exist + be delegated before we can bet inside the ER.
  const bal = await client.getBalance();
  if (bal < toUsdcUnits(CHALLENGE_STAKE_USDC)) {
    console.log(
      `[challenge] Virtual balance too low (${fromUsdcUnits(bal)} USDC). ` +
        `Deposit + delegate first (scripts/solana/agent-fund.ts).`
    );
    return false;
  }
  erReady = true;
  return true;
}

async function challengeIfMispriced(client: MimirSolanaClient, claim: OnchainClaim): Promise<void> {
  if (!AUTO_CHALLENGE || isPaused("auto_challenge") || isPaused("stake")) return;
  const key = claim.id.toString();
  if (challengedClaimIds.has(key) || evaluatedClaimIds.has(key)) return;
  if (claim.creator.equals(client.publicKey)) return;
  if (claim.challengers.some((c) => c.addr.equals(client.publicKey))) {
    evaluatedClaimIds.add(key);
    return;
  }
  if (claim.challengers.length >= claim.maxChallengers) {
    evaluatedClaimIds.add(key);
    return;
  }
  if (!DRY_RUN && !(await ensureErStake(client))) return;

  console.log(`\n[challenge] Evaluating claim #${claim.id}: "${claim.question.slice(0, 60)}..."`);
  evaluatedClaimIds.add(key);

  const evidence = await fetchEvidence(claim.resolutionUrl);
  if (evidence.fetcher === "none") {
    console.log("[challenge] Skipping LLM, no evidence available");
    return;
  }
  let rawVerdict: OracleVerdict;
  try {
    rawVerdict = await evaluateClaim(claim, evidence.text, "forecast");
  } catch (err) {
    // An LLM hiccup is not a considered "no": let a later poll look again.
    evaluatedClaimIds.delete(key);
    throw err;
  }
  const verdict = applyFetcherTrust(rawVerdict, evidence.fetcher);
  // Every pre-deadline forecast is logged for the calibration page.
  await recordForecast({
    claimId: Number(claim.id),
    forecaster: "oracle",
    pChallengers: probabilityFromVerdict(verdict.verdict, verdict.confidence),
    verdict: verdict.verdict,
    confidence: verdict.confidence,
  }).catch(() => undefined);
  console.log(`[challenge] Early verdict: ${verdict.verdict} (${verdict.confidence}%)`);

  if (verdict.verdict !== "CHALLENGERS_WIN" || verdict.confidence < CHALLENGE_CONFIDENCE) {
    console.log("[challenge] Not confident enough to stake, skipping");
    return;
  }

  // Kelly at the claim's real pool odds (a challenger wins a share of the
  // creator's stake, not even money), never above 10% of the bankroll or
  // CHALLENGE_MAX_CREATOR_MULTIPLE × the creator's stake.
  const bankroll = fromUsdcUnits(await client.getBalance());
  const stakeUsdc =
    Math.floor(
      challengerKellyStake({
        confidencePct: verdict.confidence,
        cap: Math.min(ORACLE_KELLY_CAP, 0.1),
        bankroll,
        creatorStake: fromUsdcUnits(claim.creatorStake),
        totalChallengerStake: fromUsdcUnits(claim.totalChallengerStake),
        maxCreatorMultiple: CHALLENGE_MAX_CREATOR_MULTIPLE,
        minStake: Math.max(CHALLENGE_STAKE_USDC, fromUsdcUnits(MIN_STAKE_UNITS)),
      }) * 100,
    ) / 100;
  if (stakeUsdc <= 0) {
    console.log("[challenge] No edge at the pool's odds, skipping");
    return;
  }

  if (DRY_RUN) {
    console.log(`[challenge] DRY RUN: would stake ${stakeUsdc} USDC in the ER`);
    return;
  }
  console.log(`[challenge] Pool-odds Kelly → staking ${stakeUsdc} USDC INSIDE the ER...`);
  const t0 = Date.now();
  const sig = await client.challengeClaimER(claim.id, toUsdcUnits(stakeUsdc));
  challengedClaimIds.add(key);
  console.log(`[challenge] ✓ ER stake landed in ${Date.now() - t0}ms (zero fee): ${sig}`);

  // ── Flash Trade hedge ──────────────────────────────────────────────────
  if (HEDGE_MODE !== "off") {
    await hedgeStake(client, claim, stakeUsdc);
  }
}

async function hedgeStake(
  client: MimirSolanaClient,
  claim: OnchainClaim,
  stakeUsd: number
): Promise<void> {
  try {
    // Direction from the claim's (honoured) price spec, never from its wording.
    const spec = effectiveResolverSpec({ question: claim.question, resolutionUrl: claim.resolutionUrl });
    const challengersWinIfMet = winnerFor(true, claim.creatorPosition, claim.counterPosition) === "CHALLENGERS_WIN";
    const plan =
      spec?.kind === "price" && winnerFor(true, claim.creatorPosition, claim.counterPosition)
        ? planHedgeFromSpec({ spec, stakedSideWinsIfMet: challengersWinIfMet, stakeUsd }) // we staked the challenger side
        : null;
    if (!plan) {
      console.log("[hedge] No price resolver spec on this claim, no hedge");
      return;
    }
    // Live hedges sign with their own low-balance wallet, never the oracle key.
    const hedgeKey = loadHedgeKeypair();
    if (HEDGE_MODE === "live" && !hedgeKey) {
      console.warn("[hedge] HEDGE_MODE=live needs HEDGE_KEYPAIR(_JSON); not hedging");
      return;
    }
    const hedgeOwner = hedgeKey?.publicKey ?? client.publicKey;
    const px = await getFlashPrice(plan.symbol);
    console.log(
      `[hedge] ${plan.rationale} (${plan.symbol} @ $${px.priceUi.toFixed(2)})`
    );
    const built = await buildOpenPositionTx({
      inputTokenSymbol: "USDC",
      outputTokenSymbol: plan.symbol,
      inputAmountUi: plan.collateralUsd.toFixed(2),
      leverage: plan.leverage,
      tradeType: plan.tradeType,
      owner: hedgeOwner.toBase58(),
    });
    if (HEDGE_MODE === "dry") {
      console.log(
        `[hedge] DRY RUN: Flash Trade built a ready-to-sign ${plan.tradeType} tx: ` +
          `entry $${built?.newEntryPrice}, liq $${built?.newLiquidationPrice}, ` +
          `notional $${built?.youRecieveUsdUi} (${plan.leverage}x ${plan.symbol}). Not signing.`
      );
      return;
    }
    // HEDGE_MODE=live: check, then sign + send the Flash-built transaction (mainnet!).
    // The position is never closed by this worker (HEDGE_ALLOW_UNMANAGED=1 accepted that).
    const b64 = built?.transactionBase64 ?? built?.transaction ?? built;
    if (typeof b64 !== "string") throw new Error("Flash Trade returned no transaction");
    const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    const check = verifyHedgeTx(tx, hedgeOwner);
    if (!check.ok) {
      await alert(`Refused to sign a Flash Trade hedge tx for claim #${claim.id}: ${check.reason}`);
      return;
    }
    tx.sign([hedgeKey!]);
    const sig = await client.baseConnection.sendRawTransaction(tx.serialize());
    console.log(`[hedge] ✓ LIVE hedge submitted: ${sig}`);
  } catch (err: any) {
    console.warn("[hedge] Hedge attempt failed (non-fatal):", err?.message ?? err);
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────
async function poll(client: MimirSolanaClient, ctx: DecideContext): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const cfg = await client.getConfig();
  if (!cfg) {
    console.warn("[oracle] Program config not found. Is the program initialized?");
    return;
  }
  console.log(`\n[oracle] ── Poll at ${new Date().toISOString()} ── ${cfg.claimCount} claims`);

  // The on-chain pause blocks propose/challenge (the program would reject
  // them); finalize, refunds and payout cranks keep running.
  const settlementPaused = isPaused("oracle_settlement") || cfg.paused;
  if (cfg.paused) console.log("[oracle] Program is PAUSED on-chain, no proposals or challenges this poll.");
  const ids: bigint[] = [];
  for (let id = 1n; id <= cfg.claimCount; id++) ids.push(id);
  const delegated = await client.isDelegatedBatch(ids);
  let waiting = 0;
  for (const id of ids) {
    // Undelegated claims are read from the base layer only: the ER can keep
    // serving a stale snapshot after undelegation.
    const claim = delegated.get(id) ? await client.getClaim(id) : await client.getBaseClaim(id);
    if (!claim) continue;
    const key = id.toString();
    const expired = needsProposal(claim, now);
    try {
      if (expired) {
        if (settlementPaused) {
          waiting++;
        } else if ((settleBackoff.get(key) ?? 0) <= Date.now() && notReadyBackoff.ready(key)) {
          if ((await settle(client, ctx, claim)) === "deferred") {
            const delay = notReadyBackoff.defer(key);
            console.log(`[settle] Claim #${id}: next look in ${Math.round(delay / 60_000)} min`);
          } else {
            notReadyBackoff.clear(key);
          }
          settleBackoff.delete(key);
        }
      }
      if (!DRY_RUN) await advanceLifecycle(client, claim, now);
      if (!cfg.paused && (claim.state === ST_OPEN || claim.state === ST_ACTIVE) && claim.deadline > now) {
        await challengeIfMispriced(client, claim);
      }
    } catch (err) {
      if (expired) {
        // A resolve that timed out can still land. Give it time before the
        // next attempt; settle() then re-reads the base layer and sees it.
        settleBackoff.set(key, Date.now() + SETTLE_RETRY_BACKOFF_MS);
      }
      console.error(`[oracle] Error on claim ${id}:`, err);
    }
  }
  if (waiting > 0) {
    console.log(`[oracle] Settlement paused (MIMIR_PAUSE_ORACLE_SETTLEMENT or on-chain pause): ${waiting} claim(s) waiting.`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const keypair = loadAgentKeypair();
  const client = new MimirSolanaClient(keypair);
  const cfg = await client.getConfig();

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Oracle Agent · Solana × MagicBlock ER");
  console.log(`  Program    : ${client.base.programId.toBase58()}`);
  console.log(`  Oracle     : ${client.publicKey.toBase58()}`);
  console.log(`  Base RPC   : ${client.baseConnection.rpcEndpoint}`);
  console.log(`  ER RPC     : ${client.erConnection.rpcEndpoint}`);
  console.log(`  Claims     : ${cfg?.claimCount ?? "config missing!"}`);
  const house = houseAddresses(keypair);
  console.log(`  LLM        : settlement chain ${ORACLE_LLM_CHAIN.join(" → ")} (own keys${IS_MAINNET ? " only" : ""})`);
  console.log(`  Jury       : ${COUNCIL_SETTLEMENT ? `council (quorum ${COUNCIL_QUORUM}${COUNCIL_SELF_RESOLVING ? ", self-resolving" : ""})` : "solo oracle"}${DRY_RUN ? " · DRY RUN" : ""}`);
  console.log(`  House      : ${house.size} address(es) settle on FIRM verdicts only`);
  console.log(`  Auto-challenge: ${AUTO_CHALLENGE ? `YES (≥${CHALLENGE_CONFIDENCE}%)` : "OFF"}`);
  console.log(`  Flash hedge: ${HEDGE_MODE}`);
  console.log("═══════════════════════════════════════════════\n");
  if (HEDGE_MODE === "live") {
    console.warn("[hedge] !!! HEDGE_MODE=live: real perp positions are opened and NEVER closed by this worker !!!");
  }

  // Heartbeat + in-flight guard: a slow poll (slow RPC, slow LLM) is never
  // overlapped by the next tick, so no claim is settled twice.
  const ctx: DecideContext = { oracle: client.publicKey, house, jury: juryConfig() };
  const tick = reportingPoll("oracle", POLL_INTERVAL_MS, () => poll(client, ctx));
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[oracle] Fatal:", err);
  process.exit(1);
});
