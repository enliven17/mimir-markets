/**
 * Data for the /council page: every persona of both tracks with its tallies
 * (lib/council-tally.ts) and bankroll (ER virtual balance + USDC token account).
 *
 * Claims come from the Neon read index (newest 500) when it is configured,
 * else from a chain scan. The whole payload is cached per instance for 30s:
 * without it every view re-ran the scan plus two balance reads per persona.
 */
import "server-only";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MimirSolanaClient } from "@/lib/solana/client";
import { USDC_MINT } from "@/lib/solana/config";
import { councilRoster, type RosterEntry } from "@/lib/server/council-roster";
import { isIndexEnabled, readClaims } from "@/lib/server/solana-index";
import { cachedFor } from "@/lib/server/ttl-cache";
import { emptyTally, tallyCouncil, type PersonaTally, type TallyClaim } from "@/lib/council-tally";

export interface PersonaStats extends PersonaTally {
  persona: RosterEntry;
  /** ER balance + token account, base units. */
  bankroll: bigint;
  erBalance: bigint;
}

export interface CouncilStats {
  personas: PersonaStats[];
  /** Where the claims came from, for the page footnote. */
  source: "index" | "chain";
}

let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

async function loadClaims(): Promise<{ claims: TallyClaim[]; source: CouncilStats["source"] }> {
  if (isIndexEnabled()) {
    const rows = await readClaims({ limit: 500 });
    return {
      source: "index",
      claims: rows.map((r) => ({
        id: r.id,
        question: r.question,
        state: r.state,
        winnerSide: r.winner_side,
        challengers: r.challengers.map((c) => ({ addr: c.addr, stake: BigInt(c.stake) })),
      })),
    };
  }
  const all = await getReader().getAllClaims();
  return {
    source: "chain",
    claims: all.reverse().map((c) => ({
      id: Number(c.id),
      question: c.question,
      state: c.state,
      winnerSide: c.winnerSide,
      challengers: c.challengers.map((x) => ({ addr: x.addr.toBase58(), stake: x.stake })),
    })),
  };
}

async function ataUnits(owner: PublicKey): Promise<bigint> {
  try {
    const acc = await getAccount(getReader().baseConnection, getAssociatedTokenAddressSync(USDC_MINT, owner, true));
    return BigInt(acc.amount.toString());
  } catch {
    return 0n; // no token account yet, or a flaky read: show zero, never fail the page
  }
}

export const councilStats = cachedFor(async (): Promise<CouncilStats> => {
  const roster = councilRoster();
  const { claims, source } = await loadClaims();
  const tallies = tallyCouncil(roster.map((p) => p.address), claims);

  const personas = await Promise.all(
    roster.map(async (persona): Promise<PersonaStats> => {
      const tally = (persona.address && tallies.get(persona.address)) || emptyTally();
      if (!persona.address) return { persona, ...tally, bankroll: 0n, erBalance: 0n };
      const owner = new PublicKey(persona.address);
      const [er, ata] = await Promise.all([getReader().getBalance(owner).catch(() => 0n), ataUnits(owner)]);
      return { persona, ...tally, erBalance: er, bankroll: er + ata };
    }),
  );
  return { personas, source };
}, 30_000);
