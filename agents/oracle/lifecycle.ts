/**
 * Oracle keeper duties after a verdict is proposed (V3 optimistic resolution):
 *   PROPOSED past its window → finalize_resolution, then crank payouts
 *   RESOLVED with unpaid legs → crank payouts (+ returned dispute bond)
 *   ACTIVE/OPEN/DISPUTED past deadline + grace → refund_expired (escape hatch)
 *   DISPUTED → alert the operator (ALERT_WEBHOOK_URL), wait for the admin
 *              (arbiter); scripts/solana/admin.ts settle
 * Every step is permissionless on-chain, so none of it is gated by the pause
 * switch. Failures back off per claim so a stuck leg is not retried every poll.
 */
import { agentFeeAllowlistFromEnv, type MimirSolanaClient, type OnchainClaim } from "../../lib/solana/client";
import { listAgents } from "../../lib/agents/store";
import { isDbEnabled } from "../../lib/server/db";
import { ST_DISPUTED, explorerUrl } from "../../lib/solana/config";
import { alert } from "./alert";
import { canFinalize, canRefundExpired, unpaidLegs } from "../../lib/solana/lifecycle";

const CRANK_BACKOFF_MS = Number(process.env.ORACLE_CRANK_BACKOFF_MS ?? "120000");
const backoff = new Map<string, number>();
const reportedDisputes = new Set<string>();
const reportedStuckLegs = new Set<string>();

/** Active fee-earning agents from the registry may have their fee account opened by the crank. */
export function feeEarnerWallets(agents: Array<{ status: string; capabilities: string[]; payoutWallet: string }>): string[] {
  return agents.filter((a) => a.status === "active" && a.capabilities.includes("fee_earner")).map((a) => a.payoutWallet);
}

const ALLOWLIST_REFRESH_MS = 10 * 60 * 1000;
let allowlistRefreshedAt = 0;

/** AGENT_FEE_ALLOWLIST plus the registry's fee earners, refreshed every 10 min. */
async function refreshFeeAllowlist(client: MimirSolanaClient): Promise<void> {
  if (!isDbEnabled() || Date.now() - allowlistRefreshedAt < ALLOWLIST_REFRESH_MS) return;
  allowlistRefreshedAt = Date.now();
  try {
    client.agentFeeAllowlist = new Set([...agentFeeAllowlistFromEnv(), ...feeEarnerWallets(await listAgents(1000))]);
  } catch (err: any) {
    console.warn("[lifecycle] agent fee allowlist refresh failed:", err?.message ?? err);
  }
}

async function crank(client: MimirSolanaClient, id: bigint): Promise<void> {
  await refreshFeeAllowlist(client);
  const { paid, failed } = await client.crankPayouts(id);
  if (paid) console.log(`[lifecycle] ✓ Claim #${id}: ${paid} payout leg(s) cranked`);
  if (failed.length) {
    backoff.set(id.toString(), Date.now() + CRANK_BACKOFF_MS);
    console.warn(`[lifecycle] Claim #${id}: ${failed.length} leg(s) failed (retry later): ${failed.join("; ")}`);
    // A leg waiting on an unknown agent's fee account: tell the operator once, not every poll.
    if (!reportedStuckLegs.has(id.toString()) && failed.some((f) => f.includes("fee account"))) {
      reportedStuckLegs.add(id.toString());
      await alert(`Claim #${id}: a payout waits for an agent fee account to be opened (open_fee_account): ${failed.join("; ")}`);
    }
  }
}

/** Advance one claim past proposal. Returns true when it did on-chain work. */
export async function advanceLifecycle(client: MimirSolanaClient, claim: OnchainClaim, now: number): Promise<boolean> {
  const key = claim.id.toString();
  if ((backoff.get(key) ?? 0) > Date.now()) return false;

  try {
    if (canFinalize(claim, now)) {
      const sig = await client.finalizeResolution(claim.id);
      console.log(`[lifecycle] ✓ Claim #${claim.id} finalized: ${explorerUrl("tx", sig)}`);
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
      await alert(
        `Claim #${claim.id} is DISPUTED by ${claim.disputer.toBase58()}: ` +
          "waiting for the admin (scripts/solana/admin.ts settle)"
      );
    }
  } catch (err: any) {
    backoff.set(key, Date.now() + CRANK_BACKOFF_MS);
    console.warn(`[lifecycle] Claim #${claim.id} step failed (retry later):`, err?.message ?? err);
  }
  return false;
}
