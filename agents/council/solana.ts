/**
 * Mimir Council — Solana × MagicBlock ER edition
 *
 * Two juries of personas (agents/council/personas.ts: the classic ten and the
 * philosophers) sweep every open market. Every bet is an Ephemeral Rollup
 * transaction: zero fee, ~30ms.
 *
 * Each persona signs with a keypair derived from the admin secret + slug
 * (.keys/council/<slug>.json wins locally). Each cycle the worker rebalances
 * persona funds (winnings land in the token account; they are swept back into
 * the vault and re-delegated to the ER), then runs the shared pipeline in
 * agents/council/shared/persona-runner.ts for every (claim, persona) pair:
 * exact-category specialists, rule personas on pool state, LLM personas with
 * a fenced bias prompt over one cached evidence fetch per claim, Kelly-sized
 * stakes against the ER bankroll.
 *
 * Personas can only challenge — settlement stays with the oracle, market
 * creation with the market-creator. Agreeing with the creator means abstaining.
 *
 * Run:  npm run council:solana [-- --dry-run] [-- --once]
 *   --dry-run (or COUNCIL_DRY_RUN=1): decide and log, never fund, stake or
 *             write forecasts
 *   --once:   run one cycle and exit
 * Env: SOLANA_KEYPAIR[_JSON]     admin (persona keys derive from it; pays SOL fees)
 *      COUNCIL_POLL_INTERVAL_MS  (default 60000)
 *      COUNCIL_LLM_THROTTLE_MS   (default 4500) serial gap between LLM calls
 *      COUNCIL_MAX_CLAIMS        (default 12) claims per cycle, closest deadline first
 *      COUNCIL_REEVAL_MS         (default 1800000) how long an LLM abstention stands
 *      COUNCIL_TRACK             classic | philosopher (default both)
 *      COUNCIL_PERSONA_LIMIT     (default all)
 *      COUNCIL_PEER_READS=1      let personas read earlier personas' takes this cycle
 *      COUNCIL_PEER_READS_PER_PERSONA (default 2)
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { loadAgentKeypair, loadPersonaKeypair } from "../../lib/solana/keypair";
import { isPaused } from "../../lib/ops/flags";
import { reportingPoll } from "../../lib/ops/heartbeat";
import { activePersonas, trackOf, type PersonaSpec } from "./personas";
import { MimirSolanaClient, type OnchainClaim } from "../../lib/solana/client";
import { SOLANA_RPC, USDC_MINT, toUsdcUnits, fromUsdcUnits, ST_OPEN, ST_ACTIVE } from "../../lib/solana/config";
import { createThrottle, runPersonaForClaim, type RunnerContext } from "./shared/persona-runner";
import { PeerBoard } from "./shared/peer-reasoning";
import type { EvidenceCacheEntry } from "./shared/types";

const POLL_INTERVAL_MS = Number(process.env.COUNCIL_POLL_INTERVAL_MS ?? "60000");
const LLM_THROTTLE_MS = Number(process.env.COUNCIL_LLM_THROTTLE_MS ?? "4500");
const PERSONA_LIMIT = Number(process.env.COUNCIL_PERSONA_LIMIT ?? "0");
const MAX_CLAIMS = Number(process.env.COUNCIL_MAX_CLAIMS ?? "12");
const REEVAL_MS = Number(process.env.COUNCIL_REEVAL_MS ?? "1800000");
const PEER_READS = process.env.COUNCIL_PEER_READS === "1" ? Number(process.env.COUNCIL_PEER_READS_PER_PERSONA ?? "2") : 0;
const DRY_RUN = process.argv.includes("--dry-run") || process.env.COUNCIL_DRY_RUN === "1";
const ONCE = process.argv.includes("--once");
/** Below this ER balance a persona is topped up from its token account. */
const ER_FLOOR = toUsdcUnits(2);

interface CouncilMember {
  spec: PersonaSpec;
  keypair: Keypair;
  client: MimirSolanaClient;
  funded: boolean;
  /** Logged "nothing to fund" once, not every cycle. */
  reportedEmpty: boolean;
}

// ── Funding (base layer) ──────────────────────────────────────────────────
// Devnet USDC is Circle's faucet mint: nothing here mints. USDC that reaches a
// persona's token account (faucet, transfers, payouts, jury bonuses) is swept
// into the vault and delegated to the ER. `npm run system:status` lists how
// much each wallet is short.
async function readAta(connection: Connection, owner: PublicKey): Promise<bigint> {
  try {
    const acc = await getAccount(connection, getAssociatedTokenAddressSync(USDC_MINT, owner, true));
    return BigInt(acc.amount.toString());
  } catch {
    return 0n; // no token account yet
  }
}

/** Rebalance one persona. Returns true when it sent transactions (so the caller paces RPC). */
async function fundPersona(connection: Connection, admin: Keypair, member: CouncilMember): Promise<boolean> {
  const { client, spec, keypair } = member;
  const er = await client.getBalance();
  if (er >= ER_FLOOR) {
    if (!member.funded) console.log(`[fund] ${spec.emoji} ${spec.slug}: ER-ready (${fromUsdcUnits(er)} USDC)`);
    member.funded = true;
    return false;
  }

  // Winnings land in the token account, not the ER balance, so a persona that
  // wins runs its ER balance down while USDC piles up in its ATA.
  const ata = await readAta(connection, keypair.publicKey);
  if (ata < ER_FLOOR) {
    member.funded = er > 0n;
    if (!member.reportedEmpty) {
      console.log(`[fund] ${spec.emoji} ${spec.slug}: no USDC to fund (ER ${fromUsdcUnits(er)}, ATA ${fromUsdcUnits(ata)}) — sits out staking`);
      member.reportedEmpty = true;
    }
    return false;
  }
  member.reportedEmpty = false;

  const sol = await connection.getBalance(keypair.publicKey);
  if (sol < 0.01 * LAMPORTS_PER_SOL) {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: keypair.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL }),
      ),
      [admin],
    );
  }

  // A delegated balance PDA can't take a base-layer deposit: pull it back first.
  if (await client.isBalanceDelegated(keypair.publicKey)) {
    console.log(`[fund] ${spec.emoji} ${spec.slug}: rebalancing — undelegating ER balance…`);
    try {
      await client.undelegateBalance();
    } catch (err: any) {
      console.warn(`[fund] ${spec.slug} undelegate failed:`, err?.message ?? err);
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!(await client.isBalanceDelegated(keypair.publicKey))) break;
    }
  }

  const sweep = await readAta(connection, keypair.publicKey);
  if (sweep < ER_FLOOR) return true;
  console.log(`[fund] ${spec.emoji} ${spec.slug}: sweeping ${fromUsdcUnits(sweep)} USDC into the ER…`);
  await client.deposit(sweep);
  await client.delegateBalance();
  member.funded = true;
  console.log(`[fund] ${spec.emoji} ${spec.slug}: ✓ ${fromUsdcUnits(sweep)} USDC delegated to the ER`);
  return true;
}

async function fundAll(connection: Connection, admin: Keypair, members: CouncilMember[]): Promise<void> {
  for (const member of members) {
    try {
      // Public devnet RPC rate-limits bursts of funding transactions (429s).
      if (await fundPersona(connection, admin, member)) await new Promise((r) => setTimeout(r, 2000));
    } catch (err: any) {
      console.warn(`[fund] ${member.spec.slug} failed:`, err?.message ?? err);
    }
  }
}

// ── Cycle ─────────────────────────────────────────────────────────────────
/** `${claimId}:${slug}` → time until which a considered LLM abstention stands. */
const decidedUntil = new Map<string, number>();
const throttle = createThrottle(LLM_THROTTLE_MS);
const peers = new PeerBoard();

async function joinableClaims(reader: MimirSolanaClient, claimCount: bigint): Promise<OnchainClaim[]> {
  const now = Math.floor(Date.now() / 1000);
  const open: OnchainClaim[] = [];
  for (let id = 1n; id <= claimCount; id++) {
    const c = await reader.getClaim(id);
    if (c && (c.state === ST_OPEN || c.state === ST_ACTIVE) && c.deadline > now + 90) open.push(c);
  }
  // Closest to settling first, and bounded: keeps LLM volume predictable.
  return open.sort((a, b) => a.deadline - b.deadline).slice(0, MAX_CLAIMS > 0 ? MAX_CLAIMS : undefined);
}

async function cycle(members: CouncilMember[], reader: MimirSolanaClient): Promise<void> {
  if (isPaused("stake")) {
    console.log("[council] Staking paused (MIMIR_PAUSE_STAKE) — skipping the sweep.");
    return;
  }
  const cfg = await reader.getConfig();
  if (!cfg) return;
  if (cfg.paused) {
    console.log("[council] Program is PAUSED on-chain — challenges are rejected, skipping the sweep.");
    return;
  }

  const claims = await joinableClaims(reader, cfg.claimCount);
  console.log(`\n[council] ── ${new Date().toISOString()} — ${claims.length} joinable market(s)${DRY_RUN ? " [dry run]" : ""}`);

  const now = Date.now();
  for (const [k, until] of decidedUntil) if (until <= now) decidedUntil.delete(k);
  peers.clear();
  const ctx: RunnerContext & { dryRun: boolean } = {
    evidenceCache: new Map<string, EvidenceCacheEntry>(),
    throttle,
    peers,
    peerReads: PEER_READS,
    recordForecasts: !DRY_RUN,
    dryRun: DRY_RUN,
  };

  let stakes = 0;
  for (const claim of claims) {
    for (const member of members) {
      const { spec, client } = member;
      if (!member.funded && !DRY_RUN) continue;
      const key = `${claim.id}:${spec.slug}`;
      if (decidedUntil.has(key)) continue;
      try {
        const out = await runPersonaForClaim(spec, client, claim, ctx);
        if (out.kind === "abstained") {
          decidedUntil.set(key, Date.now() + REEVAL_MS);
          if (DRY_RUN) console.log(`[council] ${spec.emoji} ${spec.slug} #${claim.id}: ${out.decision.rationale.slice(0, 160)}`);
        } else if (out.kind === "retry" && DRY_RUN) {
          console.log(`[council] ${spec.emoji} ${spec.slug} #${claim.id}: (retry) ${out.decision.rationale.slice(0, 160)}`);
        } else if (out.kind === "staked") {
          stakes++;
          // The persona is in now; the challenger list refreshes next cycle.
          claim.challengers.push({ addr: client.publicKey, stake: out.stakeUnits, paid: false, agent: PublicKey.default });
          console.log(
            `[council] ${spec.emoji} ${spec.slug} ${out.sig ? "staked" : "would stake"} ${fromUsdcUnits(out.stakeUnits)} USDC ` +
              `on claim #${claim.id}${out.sig ? " via ER" : ""} — ${out.decision.rationale.slice(0, 140)}`,
          );
        }
      } catch (err: any) {
        console.warn(`[council] ${spec.emoji} ${spec.slug} failed on #${claim.id}:`, err?.message ?? err);
      }
    }
  }
  console.log(`[council] Cycle complete — ${stakes} ${DRY_RUN ? "would-be " : ""}stake(s).`);
}

// ── Entry point ───────────────────────────────────────────────────────────
async function main() {
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const admin = loadAgentKeypair();

  const roster = activePersonas();
  const members: CouncilMember[] = (PERSONA_LIMIT > 0 ? roster.slice(0, PERSONA_LIMIT) : roster).map((spec) => {
    const keypair = loadPersonaKeypair(admin, spec.slug);
    return { spec, keypair, client: new MimirSolanaClient(keypair), funded: false, reportedEmpty: false };
  });
  const tracks = [...new Set(members.map((m) => trackOf(m.spec)))].join(" + ");

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Council — Solana × MagicBlock ER");
  console.log(`  Tracks   : ${tracks} (${members.length} personas)`);
  console.log(`  Personas : ${members.map((m) => m.spec.emoji).join(" ")}`);
  console.log(`  Cadence  : every ${POLL_INTERVAL_MS / 1000}s · ≤${MAX_CLAIMS} claims · LLM gap ${LLM_THROTTLE_MS / 1000}s`);
  console.log(`  Peer reads: ${PEER_READS > 0 ? `${PEER_READS}/decision` : "off"}${DRY_RUN ? " · DRY RUN (no funding, stakes or forecasts)" : ""}`);
  console.log("═══════════════════════════════════════════════\n");

  const reader = new MimirSolanaClient(admin);
  const run = async () => {
    // Every cycle, not just once: a persona that wins drains its ER balance
    // while winnings pile up in its ATA. Cheap when the balance is fine. A
    // paused council (MIMIR_PAUSE_COUNCIL_WORKER) moves no money at all:
    // reportingPoll skips the whole cycle.
    if (!DRY_RUN) await fundAll(connection, admin, members);
    await cycle(members, reader);
  };

  if (ONCE) {
    if (isPaused("council_worker")) console.log("[council] Paused (MIMIR_PAUSE_COUNCIL_WORKER) — nothing to do.");
    else await run();
    process.exit(0);
  }

  // Heartbeat + MIMIR_PAUSE_COUNCIL_WORKER + no overlapping cycles.
  const safeCycle = reportingPoll("council", POLL_INTERVAL_MS, run);
  await safeCycle();
  setInterval(safeCycle, POLL_INTERVAL_MS);
}

// web3.js confirm subscriptions can reject on detached promises when the
// public devnet RPC throws 429s — don't let those kill the worker.
process.on("unhandledRejection", (err) => {
  console.warn("[council] Unhandled rejection (non-fatal):", err);
});

main().catch((err) => {
  console.error("[council] Fatal:", err);
  process.exit(1);
});
