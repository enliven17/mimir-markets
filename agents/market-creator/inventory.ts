/**
 * One pass over the program's claims per cycle:
 *
 *  - cancel the creator's own claims that expired without a challenger (no
 *    winning side exists, so they would sit dead with the stake locked;
 *    cancelling refunds it; undelegate first since the PDA lives in the ER);
 *  - count JOINABLE claims (OPEN/ACTIVE with the deadline ahead) from every
 *    creator, which drives MAX_ACTIVE_CLAIMS. A raw "unresolved" count would
 *    lump in cancelled and abandoned expired claims and pin the cap forever;
 *  - collect their signatures for the duplicate guard.
 */
import type { MimirSolanaClient, OnchainClaim } from "../../lib/solana/client";
import { ST_ACTIVE, ST_OPEN } from "../../lib/solana/config";
import { signatureOf, type ClaimSignature } from "./dedupe";

export interface Inventory {
  joinable: number;
  signatures: ClaimSignature[];
  /** Own expired claims with no challenger, to cancel. */
  expiredEmpty: bigint[];
}

export function summarizeInventory(
  claims: OnchainClaim[],
  creator: { equals(other: any): boolean } | string,
  nowSec = Math.floor(Date.now() / 1000),
): Inventory {
  const isOwn = (c: OnchainClaim) =>
    typeof creator === "string" ? c.creator.toBase58() === creator : creator.equals(c.creator);
  const inv: Inventory = { joinable: 0, signatures: [], expiredEmpty: [] };
  for (const c of claims) {
    const live = c.state === ST_OPEN || c.state === ST_ACTIVE;
    if (live && c.deadline > nowSec) {
      inv.joinable++;
      inv.signatures.push(signatureOf(c, `#${c.id}`));
    }
    if (c.state === ST_OPEN && c.deadline <= nowSec && c.challengers.length === 0 && isOwn(c)) {
      inv.expiredEmpty.push(c.id);
    }
  }
  return inv;
}

export async function cancelExpiredEmpty(client: MimirSolanaClient, ids: bigint[], dryRun: boolean): Promise<number> {
  let cancelled = 0;
  for (const id of ids) {
    if (dryRun) {
      console.log(`[creator] (dry run) would cancel expired empty claim #${id}`);
      continue;
    }
    try {
      if (await client.isDelegated(id)) {
        await client.undelegateClaim(id);
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          if (!(await client.isDelegated(id))) break;
        }
      }
      await client.cancelClaim(id);
      cancelled++;
      console.log(`[creator] cancelled expired empty claim #${id}, stake refunded`);
    } catch (err: any) {
      console.warn(`[creator] cancel #${id} failed:`, err?.message ?? err);
    }
  }
  return cancelled;
}
