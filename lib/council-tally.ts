/**
 * Per-persona council tallies from a claim list (pure; the data comes from
 * lib/server/council-stats.ts). Amounts stay in USDC base units (bigint).
 *
 *   stakes   — lifetime challenges
 *   staked   — lifetime USDC staked
 *   atRisk   — stake on claims still holding stakes (not RESOLVED / CANCELLED:
 *              a PROPOSED or DISPUTED verdict can still change)
 *   won/lost — resolved claims the challengers won / the creator won
 *              (draws and refunds count as neither)
 */
import { holdsStakes } from "./claim-status";

export interface TallyClaim {
  id: number;
  question: string;
  state: number;
  winnerSide: number;
  challengers: { addr: string; stake: bigint }[];
}

export interface CouncilBet {
  claimId: number;
  question: string;
  stake: bigint;
  state: number;
  winnerSide: number;
}

export interface PersonaTally {
  stakes: number;
  staked: bigint;
  atRisk: bigint;
  won: number;
  lost: number;
  /** Newest first (claims arrive newest first), at most `recent`. */
  recentBets: CouncilBet[];
}

const RESOLVED = 2;
const SIDE_CREATOR = 1;
const SIDE_CHALLENGERS = 2;

export function emptyTally(): PersonaTally {
  return { stakes: 0, staked: 0n, atRisk: 0n, won: 0, lost: 0, recentBets: [] };
}

/** address → tally, for every address in `addresses` (others are ignored). */
export function tallyCouncil(addresses: readonly string[], claims: readonly TallyClaim[], recent = 3): Map<string, PersonaTally> {
  const out = new Map<string, PersonaTally>(addresses.filter(Boolean).map((a) => [a, emptyTally()]));
  for (const c of claims) {
    for (const ch of c.challengers) {
      const t = out.get(ch.addr);
      if (!t) continue;
      t.stakes += 1;
      t.staked += ch.stake;
      if (holdsStakes(c.state)) t.atRisk += ch.stake;
      if (c.state === RESOLVED && c.winnerSide === SIDE_CHALLENGERS) t.won += 1;
      if (c.state === RESOLVED && c.winnerSide === SIDE_CREATOR) t.lost += 1;
      if (t.recentBets.length < recent) {
        t.recentBets.push({ claimId: c.id, question: c.question, stake: ch.stake, state: c.state, winnerSide: c.winnerSide });
      }
    }
  }
  return out;
}
