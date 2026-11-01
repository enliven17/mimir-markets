/**
 * Server-side council roster: each persona with its Arc council wallet (lib/launch/council.json), so on-chain stakes
 * map back to a persona. Public addresses only; the Circle wallet ids live in ARC_COUNCIL_WALLETS on the backend.
 */
import { COUNCIL_PERSONAS, trackOf, type CouncilTrack } from "@/agents/council/personas";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";

export interface RosterEntry {
  slug: string;
  displayName: string;
  emoji: string;
  bio: string;
  archetype: string;
  track: CouncilTrack;
  /** Its Arc wallet (lowercase), or "" when it has none yet. */
  address: string;
  categoryFilter?: string[];
}

/** Pure roster builder: `arc` maps a slug to its Arc wallet. */
export function buildRoster(arc: (slug: string) => string | null | undefined): RosterEntry[] {
  return COUNCIL_PERSONAS.map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    emoji: p.emoji,
    bio: p.bio,
    archetype: p.archetype,
    track: trackOf(p),
    address: (arc(p.slug) ?? "").toLowerCase(),
    categoryFilter: p.categoryFilter,
  }));
}

let cached: RosterEntry[] | null = null;

export function councilRoster(): RosterEntry[] {
  return (cached ??= buildRoster((slug) => (Object.hasOwn(COUNCIL_AGENTS, slug) ? COUNCIL_AGENTS[slug].arc : null)));
}

/** Arc address (lowercase) → persona, for labelling on-chain stakers. */
export function personaByAddress(): Record<string, RosterEntry> {
  const map: Record<string, RosterEntry> = {};
  for (const e of councilRoster()) if (e.address) map[e.address] = e;
  return map;
}
