/**
 * One claim in the shape the council runtime reads (CouncilClaim), from the
 * Neon read index when it has the row, else from chain. Cached per instance
 * for 20s so a burst of council API reads costs one lookup per claim.
 *
 * Null when the claim does not exist; throws on an RPC failure (callers must
 * not report that as "not found" to a client, nor cache it; cachedFor drops
 * rejections).
 */
import "server-only";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import { isIndexEnabled, readClaim, readClaims, type SolanaClaimRow } from "@/lib/server/solana-index";
import { cachedFor } from "@/lib/server/ttl-cache";
import type { CouncilClaim } from "@/agents/council/shared/types";

let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

function fromRow(r: SolanaClaimRow): CouncilClaim {
  return {
    id: BigInt(r.id),
    creator: new PublicKey(r.creator),
    question: r.question,
    creatorPosition: r.creator_position,
    counterPosition: r.counter_position,
    resolutionUrl: r.resolution_url,
    category: r.category,
    creatorStake: BigInt(r.creator_stake),
    totalChallengerStake: BigInt(r.total_challenger_stake),
    deadline: Number(r.deadline),
    state: r.state,
    maxChallengers: r.max_challengers,
    challengers: r.challengers.map((c) => ({
      addr: new PublicKey(c.addr),
      stake: BigInt(c.stake),
      paid: c.paid,
      agent: c.agent ? new PublicKey(c.agent) : PublicKey.default,
    })),
  };
}

export const loadCouncilClaim = cachedFor(async (claimId: number): Promise<CouncilClaim | null> => {
  if (isIndexEnabled()) {
    const row = await readClaim(claimId).catch(() => null);
    if (row) return fromRow(row);
  }
  return getReader().getClaim(BigInt(claimId));
}, 20_000);

const LIVE_LIMIT = 12;

/** The open and live markets, newest first. Cached 30s: every terminal chat reads it. */
export const liveCouncilClaims = cachedFor(async (_key: "live"): Promise<CouncilClaim[]> => {
  if (isIndexEnabled()) return (await readClaims({ states: [0, 1], limit: LIVE_LIMIT })).map(fromRow);
  // No index (local dev): walk back from the newest claim on chain.
  // ponytail: scans at most 40 claims, so older live markets are missed without the index.
  const client = getReader();
  const cfg = await client.getConfig();
  const out: CouncilClaim[] = [];
  for (let id = cfg?.claimCount ?? 0n; id >= 1n && out.length < LIVE_LIMIT && (cfg?.claimCount ?? 0n) - id < 40n; id--) {
    const c = await client.getClaim(id);
    if (c && (c.state === 0 || c.state === 1)) out.push(c);
  }
  return out;
}, 30_000);
