/**
 * One pass over the markets per cycle:
 *
 *  - list the creator's own markets that expired without a challenger (no
 *    winning side exists, so they would sit dead with the stake locked);
 *  - count the house's own JOINABLE claims (OPEN/ACTIVE with the deadline
 *    ahead), which drives MAX_ACTIVE_CLAIMS. A raw "unresolved" count would
 *    lump in cancelled and abandoned expired claims and pin the cap forever;
 *  - collect their signatures for the duplicate guard.
 *
 * Only claims the creator key opened count, for both: counting everyone's
 * let anyone pin the cap with cheap claims, or pre-empt a house market by
 * opening a look-alike first (audit P2-3).
 */
import type { OnchainClaim } from "../../lib/market-claim";
import { ST_ACTIVE, ST_OPEN } from "../../lib/market-codes";
import { signatureOf, type ClaimSignature } from "./dedupe";

export interface Inventory {
  joinable: number;
  signatures: ClaimSignature[];
  /** Own expired claims with no challenger, to cancel. */
  expiredEmpty: bigint[];
}

export function summarizeInventory(
  claims: OnchainClaim[],
  creator: string,
  nowSec = Math.floor(Date.now() / 1000),
): Inventory {
  const isOwn = (c: OnchainClaim) =>
    c.creator.toLowerCase() === creator.toLowerCase();
  const inv: Inventory = { joinable: 0, signatures: [], expiredEmpty: [] };
  for (const c of claims) {
    const live = c.state === ST_OPEN || c.state === ST_ACTIVE;
    if (live && c.deadline > nowSec && isOwn(c)) {
      inv.joinable++;
      inv.signatures.push(signatureOf(c, `#${c.id}`));
    }
    if (c.state === ST_OPEN && c.deadline <= nowSec && c.challengers.length === 0 && isOwn(c)) {
      inv.expiredEmpty.push(c.id);
    }
  }
  return inv;
}
