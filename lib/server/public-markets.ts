/**
 * The public read of Arc markets (GET /api/markets, /api/markets/[kind]/[id]): the shape the CLI and any outside
 * reader gets, built from the backend index. USDC amounts are decimal strings (18-decimal native USDC on Arc).
 */
import { LOCK_SECONDS } from "@/lib/arc/markets";
import { arcMarketUrl } from "@/lib/telegram";

export type MarketKind = "vs" | "pool";
export type MarketPhase = "open" | "awaiting" | "proposed" | "disputed" | "resolved" | "cancelled";
export type MarketFilter = "live" | "closing" | "settled" | "all";

export interface IndexedMarket {
  kind: MarketKind;
  marketId: number;
  creator: string;
  question: string;
  labelA: string;
  labelB: string;
  resolutionUrl: string;
  category: string;
  deadline: number;
  createdAt: number;
  status: string;
  winner: number;
  summary: string;
  stakeA: string;
  stakeB: string;
  participants: number;
}

export interface PublicMarket {
  id: string;
  kind: MarketKind;
  marketId: number;
  question: string;
  category: string;
  /** VS: A is the creator's side, B the challengers'. Pool: two open sides. */
  sideA: { label: string; usdc: string };
  sideB: { label: string; usdc: string };
  participants: number;
  creator: string;
  deadline: number;
  phase: MarketPhase;
  /** 1 side A, 2 side B, 3 draw, 4 unresolvable (refund); null until settled. */
  winner: number | null;
  summary: string | null;
  resolutionUrl: string;
  url: string;
}

const WEI = 10n ** 18n;

/** 18-decimal wei as a USDC decimal string, trailing zeros trimmed ("1.5", "0.0995"). */
export function usdc(wei: string): string {
  const v = BigInt(wei || "0");
  const whole = v / WEI;
  const frac = (v % WEI).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function phaseOf(m: Pick<IndexedMarket, "status" | "deadline">, now: number): MarketPhase {
  if (m.status === "open" || m.status === "active") return now + LOCK_SECONDS <= m.deadline ? "open" : "awaiting";
  return m.status as MarketPhase;
}

export function toPublic(m: IndexedMarket, now: number): PublicMarket {
  const phase = phaseOf(m, now);
  const settled = phase === "resolved" || phase === "cancelled";
  return {
    id: `${m.kind}-${m.marketId}`,
    kind: m.kind,
    marketId: m.marketId,
    question: m.question,
    category: m.category,
    sideA: { label: m.labelA, usdc: usdc(m.stakeA) },
    sideB: { label: m.labelB, usdc: usdc(m.stakeB) },
    participants: m.participants,
    creator: m.creator,
    deadline: m.deadline,
    phase,
    winner: settled ? m.winner : null,
    summary: m.summary || null,
    resolutionUrl: m.resolutionUrl,
    url: arcMarketUrl(m.kind, m.marketId),
  };
}

/** live: takes stakes now. closing: live and within 24 h of its deadline, soonest first. settled: resolved or refunded. */
export function filterMarkets(list: PublicMarket[], filter: MarketFilter, now: number): PublicMarket[] {
  switch (filter) {
    case "live":
      return list.filter((m) => m.phase === "open");
    case "closing":
      return list.filter((m) => m.phase === "open" && m.deadline - now < 86_400).sort((a, b) => a.deadline - b.deadline);
    case "settled":
      return list.filter((m) => m.phase === "resolved" || m.phase === "cancelled");
    default:
      return list;
  }
}

/**
 * The published CLI before 0.4 reads the retired Solana index: tell it to update instead of showing an empty list.
 * Returns the response to send, or null for every other caller.
 */
export function oldCliGone(req: Request): Response | null {
  const v = /^mimir-terminal\/0\.(\d+)\./.exec(req.headers.get("user-agent") ?? "");
  if (!v || Number(v[1]) >= 4) return null;
  return Response.json(
    { success: false, error: "Mimir markets now settle on Arc. Update the CLI: npm i -g mimir-terminal@latest" },
    { status: 410 },
  );
}

/** "vs-12", "pool-3", "12" or "#12" (VS by default) → kind and id; null when it isn't one. */
export function parseMarketRef(ref: string): { kind: MarketKind; marketId: number } | null {
  const m = /^(?:(vs|pool)[-#:]?)?#?(\d{1,9})$/i.exec(ref.trim());
  if (!m) return null;
  return { kind: (m[1]?.toLowerCase() as MarketKind | undefined) ?? "vs", marketId: Number(m[2]) };
}
