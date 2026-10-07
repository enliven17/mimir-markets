/**
 * The Arc index (convex/arc.ts markets) as the landing's feed shape
 * (lib/landing.ts), so every landing section reads Arc without knowing it.
 * Amounts go from 18-dp wei to the 6-dp units the landing formats; states use
 * the same numbering as MimirV3 (0 open … 5 disputed).
 */
import type { LandingClaim, LandingFeed } from "../landing";

export interface ArcIndexMarket {
  kind: "vs" | "pool";
  marketId: number;
  question: string;
  category: string;
  labelA: string;
  labelB: string;
  stakeA: string;
  stakeB: string;
  deadline: number;
  status: "open" | "active" | "proposed" | "disputed" | "resolved" | "cancelled";
  winner: number;
  summary: string;
  participants: number;
}

const STATE = { open: 0, active: 1, resolved: 2, cancelled: 3, proposed: 4, disputed: 5 } as const;
const units = (wei: string) => (BigInt(wei) / 1_000_000_000_000n).toString();

export function arcLandingClaim(m: ArcIndexMarket): LandingClaim {
  return {
    // Unique across both contracts for React keys; the link uses `href`.
    id: m.kind === "vs" ? m.marketId : 1_000_000 + m.marketId,
    href: `/arena/arc/${m.kind}/${m.marketId}`,
    label: `${m.kind === "vs" ? "VS" : "Pool"} #${m.marketId}`,
    question: m.question,
    category: m.category,
    creatorPosition: m.labelA,
    counterPosition: m.labelB,
    creatorStake: units(m.stakeA),
    totalChallengerStake: units(m.stakeB),
    deadline: m.deadline,
    state: STATE[m.status],
    winnerSide: m.winner,
    // The index keeps the verdict's words, not its confidence; a settled market reads as firm.
    confidence: m.status === "resolved" ? 100 : 0,
    resolutionSummary: m.summary,
    delegated: false,
    challengers: [],
  };
}

export function arcLandingFeed(markets: ArcIndexMarket[]): LandingFeed {
  const claims = markets.map(arcLandingClaim);
  const live = markets.filter((m) => m.status === "open" || m.status === "active" || m.status === "proposed" || m.status === "disputed");
  const openPool = live.reduce((sum, m) => sum + BigInt(m.stakeA) + BigInt(m.stakeB), 0n) / 1_000_000_000_000n;
  return {
    claims,
    claimCount: markets.length,
    totalResolved: markets.filter((m) => m.status === "resolved").length,
    openPool: openPool.toString(),
  };
}
