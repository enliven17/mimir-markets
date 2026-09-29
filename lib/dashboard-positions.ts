/**
 * Pure helpers over one wallet's positions for the dashboard: its role and
 * stake in each claim, the outcome for it, the payout legs it can pull now and
 * a summary of the filtered list. Amounts are USDC base units (bigint).
 */
import {
  SIDE_CHALLENGERS,
  SIDE_CREATOR,
  ST_CANCELLED,
  ST_DISPUTED,
  ST_PROPOSED,
  ST_RESOLVED,
} from "./solana/config";
import { challengerGross, creatorGross, splitFees } from "./solana/fees";

/** The claim fields these helpers read (a subset of the /api/arena claim). */
export interface PositionClaim {
  id: number;
  creator: string;
  question: string;
  category: string;
  state: number;
  winnerSide: number;
  proposedSide?: number;
  creatorStake: string;
  totalChallengerStake: string;
  creatorPaid?: boolean;
  creatorAgent?: string;
  platformFeeBps?: number;
  agentFeeBps?: number;
  challengers: Array<{ addr: string; stake: string; paid: boolean; agent?: string }>;
}

export type PositionRole = "creator" | "challenger";
export type PositionOutcome = "open" | "pending" | "won" | "lost" | "refund" | "cancelled";

export function positionRole(c: PositionClaim, viewer: string): PositionRole | null {
  if (c.creator === viewer) return "creator";
  return c.challengers.some((ch) => ch.addr === viewer) ? "challenger" : null;
}

/** What the viewer has staked in this claim (a wallet may challenge more than once). */
export function positionStake(c: PositionClaim, viewer: string): bigint {
  let units = c.creator === viewer ? BigInt(c.creatorStake || "0") : 0n;
  for (const ch of c.challengers) if (ch.addr === viewer) units += BigInt(ch.stake || "0");
  return units;
}

export function positionOutcome(c: PositionClaim, viewer: string): PositionOutcome {
  if (c.state === ST_CANCELLED) return "cancelled";
  if (c.state === ST_PROPOSED || c.state === ST_DISPUTED) return "pending";
  if (c.state !== ST_RESOLVED) return "open";
  const creator = c.creator === viewer;
  if (c.winnerSide === SIDE_CREATOR) return creator ? "won" : "lost";
  if (c.winnerSide === SIDE_CHALLENGERS) return creator ? "lost" : "won";
  return "refund";
}

export interface ClaimableLeg {
  claimId: number;
  key: string;
  role: PositionRole;
  /** Challenger index for payoutChallenger; -1 for the creator leg. */
  index: number;
  recipient: string;
  agent: string;
  gross: bigint;
  principal: bigint;
  /** After the claim's frozen profit-only fees. */
  net: bigint;
}

/** The viewer's unpaid payout legs of a RESOLVED claim, ready for a pull crank. */
export function claimableLegs(c: PositionClaim, viewer: string): ClaimableLeg[] {
  if (c.state !== ST_RESOLVED) return [];
  const creatorStake = BigInt(c.creatorStake || "0");
  const total = BigInt(c.totalChallengerStake || "0");
  const legs: ClaimableLeg[] = [];
  const add = (role: PositionRole, index: number, agent: string, g: { gross: bigint; principal: bigint } | null) => {
    if (!g) return;
    const hasAgent = Boolean(agent && agent !== viewer);
    const platformFeeBps = c.platformFeeBps ?? 0;
    const split = splitFees({
      gross: g.gross,
      principal: g.principal,
      policy: {
        platformFeeBps,
        agentOwnerFeeBps: hasAgent ? c.agentFeeBps ?? 0 : 0,
        // The platform recipient is not indexed; a present one is assumed.
        platformRecipient: platformFeeBps > 0 ? "platform" : null,
      },
      winner: viewer,
      agentOwner: hasAgent ? agent : null,
    });
    legs.push({ claimId: c.id, key: `${c.id}:${role}:${index}`, role, index, recipient: viewer, agent, gross: g.gross, principal: g.principal, net: split.netPayout });
  };
  if (c.creator === viewer && !c.creatorPaid) {
    add("creator", -1, c.creatorAgent ?? "", creatorGross(c.winnerSide, creatorStake, total));
  }
  c.challengers.forEach((ch, i) => {
    if (ch.addr !== viewer || ch.paid) return;
    add("challenger", i, ch.agent ?? "", challengerGross(c.winnerSide, BigInt(ch.stake || "0"), creatorStake, total));
  });
  return legs;
}

// ── Filters (URL state: ?tab=&cat=&min=&q=) ────────────────────────────────

export const DASHBOARD_TABS = ["all", "active", "settling", "done"] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export interface DashboardFilters {
  tab: DashboardTab;
  cat: string;
  /** Minimum own stake, whole USDC. */
  minStake: number;
  search: string;
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = { tab: "all", cat: "all", minStake: 0, search: "" };
export const DASHBOARD_MIN_STAKE_OPTIONS = [0, 5, 25, 100] as const;

export function tabOf(state: number): Exclude<DashboardTab, "all"> {
  if (state === ST_PROPOSED || state === ST_DISPUTED) return "settling";
  if (state === ST_RESOLVED || state === ST_CANCELLED) return "done";
  return "active";
}

export function parseDashboardFilters(sp: URLSearchParams, categories: readonly string[]): DashboardFilters {
  const tabRaw = (sp.get("tab") ?? "").toLowerCase();
  const tab = (DASHBOARD_TABS as readonly string[]).includes(tabRaw) ? (tabRaw as DashboardTab) : "all";
  const catRaw = (sp.get("cat") ?? "all").trim().toLowerCase();
  const min = Number(sp.get("min") ?? 0);
  return {
    tab,
    cat: categories.includes(catRaw) ? catRaw : "all",
    minStake: (DASHBOARD_MIN_STAKE_OPTIONS as readonly number[]).includes(min) ? min : 0,
    search: (sp.get("q") ?? "").slice(0, 120),
  };
}

/** Only deviations from the defaults, so shared URLs stay short. */
export function serializeDashboardFilters(f: DashboardFilters): string {
  const p = new URLSearchParams();
  if (f.tab !== "all") p.set("tab", f.tab);
  if (f.cat !== "all") p.set("cat", f.cat);
  if (f.minStake !== 0) p.set("min", String(f.minStake));
  const q = f.search.trim();
  if (q) p.set("q", q);
  return p.toString();
}

export function applyDashboardFilters<T extends PositionClaim>(claims: T[], f: DashboardFilters, viewer: string): T[] {
  const q = f.search.trim().toLowerCase();
  const minUnits = BigInt(f.minStake) * 1_000_000n;
  return claims.filter(
    (c) =>
      (f.tab === "all" || tabOf(c.state) === f.tab) &&
      (f.cat === "all" || c.category.toLowerCase() === f.cat) &&
      positionStake(c, viewer) >= minUnits &&
      (!q || c.question.toLowerCase().includes(q) || String(c.id) === q.replace(/^#/, "")),
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  total: number;
  won: number;
  lost: number;
  /** Percent of decided positions won, 0 when none decided. */
  winRate: number;
  /** Own stake in claims whose verdict is not final (OPEN, ACTIVE, PROPOSED, DISPUTED). */
  atRisk: bigint;
  /** Net received or receivable from won positions. */
  totalWon: bigint;
  counts: Record<Exclude<DashboardTab, "all">, number>;
}

export function summarizePositions(claims: PositionClaim[], viewer: string): DashboardSummary {
  const s: DashboardSummary = { total: claims.length, won: 0, lost: 0, winRate: 0, atRisk: 0n, totalWon: 0n, counts: { active: 0, settling: 0, done: 0 } };
  for (const c of claims) {
    s.counts[tabOf(c.state)] += 1;
    const outcome = positionOutcome(c, viewer);
    if (outcome === "open" || outcome === "pending") s.atRisk += positionStake(c, viewer);
    if (outcome === "won") {
      s.won += 1;
      // Paid legs are no longer in claimableLegs; recompute gross for all legs.
      s.totalWon += claimableLegs({ ...c, creatorPaid: false, challengers: c.challengers.map((ch) => ({ ...ch, paid: false })) }, viewer)
        .reduce((sum, leg) => sum + leg.net, 0n);
    }
    if (outcome === "lost") s.lost += 1;
  }
  const decided = s.won + s.lost;
  s.winRate = decided > 0 ? Math.round((s.won / decided) * 100) : 0;
  return s;
}
