/**
 * Server-side council roster: maps on-chain challenger addresses back to a
 * persona without ever exposing a secret key.
 *
 * The web process should hold no private key (audit P0-1): deploys pass the
 * persona public addresses in COUNCIL_ADDRESSES. Only off mainnet, as a dev
 * convenience, are they derived from the admin secret when that env is unset.
 */
import { Keypair } from "@solana/web3.js";
import { loadAgentKeypair, derivePersonaKeypair } from "@/lib/solana/keypair";
import { IS_MAINNET } from "@/lib/solana/config";
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
export function parseCouncilAddresses(raw: string | undefined): Record<string, string> | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Pure roster builder. `loadAdmin` is only consulted off mainnet and only when
 * no public address map is configured. Returns `cacheable: false` when the
 * addresses are unknown, so a later env fix is picked up.
 */
export function buildRoster(opts: {
  addresses: Record<string, string> | null;
  mainnet: boolean;
  loadAdmin: () => Keypair;
}): { roster: RosterEntry[]; cacheable: boolean } {
  const entry = (p: (typeof COUNCIL_PERSONAS)[number], address: string): RosterEntry => ({
    slug: p.slug,
    displayName: p.displayName,
    emoji: p.emoji,
    bio: p.bio,
    archetype: p.archetype,
    track: trackOf(p),
    address,
    categoryFilter: p.categoryFilter,
  });
  const known = opts.addresses;
  if (known) {
    return {
      roster: COUNCIL_PERSONAS.map((p) => entry(p, typeof known[p.slug] === "string" ? known[p.slug] : "")),
      cacheable: true,
    };
  }
  // Mainnet: never touch the admin secret from the web process. Personas
  // render without addresses until COUNCIL_ADDRESSES is set.
  if (opts.mainnet) return { roster: COUNCIL_PERSONAS.map((p) => entry(p, "")), cacheable: false };
  let admin: Keypair;
  try {
    admin = opts.loadAdmin();
  } catch {
    // No keypair available: addresses unknown, the page still renders personas.
    return { roster: COUNCIL_PERSONAS.map((p) => entry(p, "")), cacheable: false };
  }
  return {
    roster: COUNCIL_PERSONAS.map((p) => entry(p, derivePersonaKeypair(admin, p.slug).publicKey.toBase58())),
    cacheable: true,
  };
}

let warned = false;

export function councilRoster(): RosterEntry[] {
  if (cached) return cached;
  const addresses = parseCouncilAddresses(process.env.COUNCIL_ADDRESSES);
  if (IS_MAINNET && !addresses && !warned) {
    warned = true;
    console.error("[council-roster] COUNCIL_ADDRESSES is not set on mainnet: persona addresses unknown");
  }
  const { roster, cacheable } = buildRoster({ addresses, mainnet: IS_MAINNET, loadAdmin: loadAgentKeypair });
  if (cacheable) cached = roster;
  return roster;
}

/** address (base58) → persona, for labelling on-chain challengers. */
export function personaByAddress(): Record<string, RosterEntry> {
  const map: Record<string, RosterEntry> = {};
  for (const e of councilRoster()) if (e.address) map[e.address] = e;
  return map;
}
