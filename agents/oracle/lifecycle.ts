/**
 * Oracle keeper duties after a verdict is proposed (V3 optimistic resolution):
 *   PROPOSED past its window → finalize_resolution, then crank payouts
 *   RESOLVED with unpaid legs → crank payouts (+ returned dispute bond)
 *   ACTIVE/OPEN/DISPUTED past deadline + grace → refund_expired (escape hatch)
 *   DISPUTED → wait for the admin (arbiter); scripts/solana/admin.ts settle
 * Every step is permissionless on-chain, so none of it is gated by the pause
 * switch. Failures back off per claim so a stuck leg is not retried every poll.
 */
import type { MimirSolanaClient, OnchainClaim } from "../../lib/solana/client";
import { ST_DISPUTED } from "../../lib/solana/config";
import { canFinalize, canRefundExpired, unpaidLegs } from "../../lib/solana/lifecycle";

const CRANK_BACKOFF_MS = Number(process.env.ORACLE_CRANK_BACKOFF_MS ?? "120000");
const backoff = new Map<string, number>();
const reportedDisputes = new Set<string>();

async function crank(client: MimirSolanaClient, id: bigint): Promise<void> {
  const { paid, failed } = await client.crankPayouts(id);
  if (paid) console.log(`[lifecycle] ✓ Claim #${id}: ${paid} payout leg(s) cranked`);
  if (failed.length) {
    backoff.set(id.toString(), Date.now() + CRANK_BACKOFF_MS);
    console.warn(`[lifecycle] Claim #${id}: ${failed.length} leg(s) failed (retry later): ${failed.join("; ")}`);
  }
}

/** Advance one claim past proposal. Returns true when it did on-chain work. */
export async function advanceLifecycle(client: MimirSolanaClient, claim: OnchainClaim, now: number): Promise<boolean> {
  const key = claim.id.toString();
  if ((backoff.get(key) ?? 0) > Date.now()) return false;

  try {
    if (canFinalize(claim, now)) {
      const sig = await client.finalizeResolution(claim.id);
      console.log(`[lifecycle] ✓ Claim #${claim.id} finalized: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
      await crank(client, claim.id);
      return true;
    }
    if (canRefundExpired(claim, now)) {
      if (!(await client.ensureClaimOnBase(claim.id))) {
        backoff.set(key, Date.now() + CRANK_BACKOFF_MS);
        return false;
      }
      const sig = await client.refundExpired(claim.id);
      console.log(`[lifecycle] ✓ Claim #${claim.id} refunded after the grace period: ${sig}`);
      await crank(client, claim.id);
      return true;
    }
    if (unpaidLegs(claim) > 0) {
      await crank(client, claim.id);
      return true;
    }
    if (claim.state === ST_DISPUTED && !reportedDisputes.has(key)) {
      reportedDisputes.add(key);
      console.log(
        `[lifecycle] Claim #${claim.id} is DISPUTED by ${claim.disputer.toBase58()}. ` +
          "waiting for the admin: scripts/solana/admin.ts settle"
      );
    }
  } catch (err: any) {
    backoff.set(key, Date.now() + CRANK_BACKOFF_MS);
    console.warn(`[lifecycle] Claim #${claim.id} step failed (retry later):`, err?.message ?? err);
  }
  return false;
}
