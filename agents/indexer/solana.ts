/**
 * Mimir Indexer: mirrors on-chain claim state into the Neon read-index.
 *
 * Every cycle it walks all claims (reading from whichever layer owns each:
 * the Ephemeral Rollup for delegated claims, the base layer otherwise) and
 * upserts a denormalized snapshot into Postgres. The arena feed then serves
 * from one SQL query instead of fanning out RPC reads on every poll.
 *
 * No-ops cleanly if DATABASE_URL is unset (the feed falls back to chain reads).
 *
 * Run: npx tsx --env-file-if-exists=.env.local agents/indexer/solana.ts
 * Env: INDEXER_POLL_INTERVAL_MS (default 15000)
 */
import { PublicKey } from "@solana/web3.js";
import { loadAgentKeypair } from "../../lib/solana/keypair";
import { MimirSolanaClient } from "../../lib/solana/client";
import { isIndexEnabled, upsertClaim, type SolanaClaimRow } from "../../lib/server/solana-index";
import { claimEvents, type NotificationEvent } from "../../lib/notifications";
import { loadClaimSnapshots, recordNotifications } from "../../lib/server/notifications";
import { reportingPoll } from "../../lib/ops/heartbeat";

/** PublicKey.default (all zeros) means "none" on-chain; store it as ''. */
const keyOrEmpty = (k: PublicKey): string => (k.equals(PublicKey.default) ? "" : k.toBase58());

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? "30000");
// Small pause between getClaim calls to stay within public RPC rate limits.
const CLAIM_FETCH_DELAY_MS = Number(process.env.INDEXER_CLAIM_DELAY_MS ?? "150");

async function cycle(client: MimirSolanaClient): Promise<void> {
  const cfg = await client.getConfig();
  if (!cfg) {
    console.warn("[indexer] config not found. Is the program initialized?");
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  let written = 0;

  // Batch-fetch delegation status for ALL claims in a single getMultipleAccountsInfo
  // call instead of N individual getAccountInfo calls.
  const allIds: bigint[] = [];
  for (let id = 1n; id <= cfg.claimCount; id++) allIds.push(id);
  const delegatedMap = await client.isDelegatedBatch(allIds);
  // What the index held before this sweep: each re-read claim is diffed
  // against it to derive notifications (new challenger, proposed, settled…).
  const previous = await loadClaimSnapshots().catch((err) => {
    console.warn("[indexer] could not load previous snapshots:", String(err).slice(0, 120));
    return null;
  });
  const events: NotificationEvent[] = [];

  for (const id of allIds) {
    const delegated = delegatedMap.get(id) ?? false;
    // Undelegated claims come from the base layer only: the ER can keep
    // serving a stale snapshot after undelegation (e.g. ACTIVE after PROPOSED).
    const claim = delegated ? await client.getClaim(id) : await client.getBaseClaim(id).catch(() => null);
    if (!claim) {
      if (CLAIM_FETCH_DELAY_MS > 0) await new Promise((r) => setTimeout(r, CLAIM_FETCH_DELAY_MS));
      continue;
    }
    const row: SolanaClaimRow = {
      id: Number(claim.id),
      creator: claim.creator.toBase58(),
      question: claim.question,
      creator_position: claim.creatorPosition,
      counter_position: claim.counterPosition,
      resolution_url: claim.resolutionUrl,
      category: claim.category,
      creator_stake: claim.creatorStake.toString(),
      total_challenger_stake: claim.totalChallengerStake.toString(),
      deadline: claim.deadline,
      state: claim.state,
      winner_side: claim.winnerSide,
      resolution_summary: claim.resolutionSummary,
      confidence: claim.confidence,
      created_at: claim.createdAt,
      max_challengers: claim.maxChallengers,
      delegated,
      challengers: claim.challengers.map((c) => ({
        addr: c.addr.toBase58(),
        stake: c.stake.toString(),
        paid: c.paid,
        agent: keyOrEmpty(c.agent),
      })),
      updated_at: now,
      creator_paid: claim.creatorPaid,
      proposed_side: claim.proposedSide,
      proposed_at: claim.proposedAt,
      disputable_until: claim.disputableUntil,
      disputer: keyOrEmpty(claim.disputer),
      disputed_at: claim.disputedAt,
      bond: claim.bond.toString(),
      bond_state: claim.bondState,
      dispute_window: claim.disputeWindow,
      resolution_grace: claim.resolutionGrace,
      resolved_at: claim.resolvedAt,
      creator_agent: keyOrEmpty(claim.creatorAgent),
      platform_fee_bps: claim.platformFeeBps,
      agent_fee_bps: claim.agentFeeBps,
      total_fees: claim.totalFees.toString(),
    };
    await upsertClaim(row);
    if (previous) events.push(...claimEvents(previous.get(row.id) ?? null, row));
    written++;
    if (CLAIM_FETCH_DELAY_MS > 0) await new Promise((r) => setTimeout(r, CLAIM_FETCH_DELAY_MS));
  }
  // After the sweep, so a slow webhook never delays indexing.
  const fresh = await recordNotifications(events).catch((err) => {
    console.warn("[indexer] notifications failed:", String(err).slice(0, 120));
    return 0;
  });
  console.log(`[indexer] ${new Date().toISOString()}: synced ${written}/${cfg.claimCount} claims, ${fresh} new notifications`);
}

async function main(): Promise<void> {
  if (!isIndexEnabled()) {
    console.log("[indexer] DATABASE_URL not set, nothing to index, exiting cleanly.");
    return;
  }
  const client = new MimirSolanaClient(loadAgentKeypair());

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Indexer · Solana → Neon read-index");
  console.log(`  Program : ${client.base.programId.toBase58()}`);
  console.log(`  Cadence : every ${POLL_INTERVAL_MS / 1000}s`);
  console.log("═══════════════════════════════════════════════\n");

  // Heartbeat + no overlapping cycles (a full sweep can outlast the interval
  // on a slow public RPC).
  const safe = reportingPoll("indexer", POLL_INTERVAL_MS, () => cycle(client));
  await safe();
  setInterval(safe, POLL_INTERVAL_MS);
}

process.on("unhandledRejection", (err) => {
  console.warn("[indexer] unhandled rejection (non-fatal):", String(err).slice(0, 120));
});

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
