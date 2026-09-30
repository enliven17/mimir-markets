/**
 * Server-side council roster: derives each persona's public address from the
 * admin secret (same derivation the worker uses) so the UI can map on-chain
 * challenger addresses back to a persona without ever exposing a secret key.
 */
import { loadAgentKeypair, derivePersonaKeypair } from "@/lib/solana/keypair";
import { COUNCIL_PERSONAS, trackOf, type CouncilTrack } from "@/agents/council/personas";

export interface RosterEntry {
  slug: string;
  displayName: string;
  emoji: string;
  bio: string;
  archetype: string;
  track: CouncilTrack;
  address: string;
  categoryFilter?: string[];
}

let cached: RosterEntry[] | null = null;

/**
 * Web deploys that must not hold the admin secret pass the derived public
 * addresses instead: COUNCIL_ADDRESSES = {"optimist":"<base58>", ...}
 * (print them with `npm run system:status`).
 */
function publicAddresses(): Record<string, string> | null {
  const raw = process.env.COUNCIL_ADDRESSES?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function councilRoster(): RosterEntry[] {
  if (cached) return cached;
  const known = publicAddresses();
  if (known) {
    cached = COUNCIL_PERSONAS.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      emoji: p.emoji,
      bio: p.bio,
      archetype: p.archetype,
      track: trackOf(p),
      address: typeof known[p.slug] === "string" ? known[p.slug] : "",
      categoryFilter: p.categoryFilter,
    }));
    return cached;
  }
  let admin;
  try {
    admin = loadAgentKeypair();
  } catch {
    // No keypair available (e.g. web service without the secret): roster
    // addresses are unknown, but the page can still render personas.
    return COUNCIL_PERSONAS.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      emoji: p.emoji,
      bio: p.bio,
      archetype: p.archetype,
      track: trackOf(p),
      address: "",
      categoryFilter: p.categoryFilter,
    }));
  }
  cached = COUNCIL_PERSONAS.map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    emoji: p.emoji,
    bio: p.bio,
    archetype: p.archetype,
    track: trackOf(p),
    address: derivePersonaKeypair(admin, p.slug).publicKey.toBase58(),
    categoryFilter: p.categoryFilter,
  }));
  return cached;
}

/** address (base58) → persona, for labelling on-chain challengers. */
export function personaByAddress(): Record<string, RosterEntry> {
  const map: Record<string, RosterEntry> = {};
  for (const e of councilRoster()) if (e.address) map[e.address] = e;
  return map;
}
