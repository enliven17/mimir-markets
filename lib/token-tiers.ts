/**
 * Holder tiers and token gates. Pure: balances come in, decisions go out.
 *
 * Balances are whole-token UI amounts (decimals already applied) read from
 * Solana mainnet (lib/server/mainnet.ts). The wallet a user connects to the
 * devnet app is the same ed25519 key on mainnet, so its mainnet balance is
 * "theirs"; a server-side perk that needs proof of control verifies a signed
 * holder proof (lib/token-proof.ts) first.
 *
 * $ANSEM holders are recognised too: holding at least `ansemHolderMin` ANSEM
 * lifts a wallet to at least HOLDER.
 */

export const TOKEN_TIERS = ["none", "holder", "backer", "oracle-circle"] as const;
export type TokenTier = (typeof TOKEN_TIERS)[number];

export interface TierThresholds {
  holder: number;
  backer: number;
  oracleCircle: number;
  /** ANSEM balance that counts as HOLDER. 0 turns the $ANSEM path off. */
  ansemHolderMin: number;
}

export interface TokenBalances {
  mimir: number;
  ansem: number;
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Defaults assume a pump.fun supply of 1,000,000,000: holder 10k (0.001%),
 * backer 1M (0.1%), oracle circle 10M (1%). $ANSEM: 100 tokens.
 */
export function tierThresholdsFromEnv(env: Env = process.env): TierThresholds {
  return {
    holder: num(env, "MIMIR_TIER_HOLDER_MIN", 10_000),
    backer: num(env, "MIMIR_TIER_BACKER_MIN", 1_000_000),
    oracleCircle: num(env, "MIMIR_TIER_ORACLE_CIRCLE_MIN", 10_000_000),
    ansemHolderMin: num(env, "ANSEM_HOLDER_MIN", 100),
  };
}

export function tierRank(tier: TokenTier): number {
  return TOKEN_TIERS.indexOf(tier);
}

export function tierAtLeast(tier: TokenTier, min: TokenTier): boolean {
  return tierRank(tier) >= tierRank(min);
}

export function isTokenTier(v: unknown): v is TokenTier {
  return typeof v === "string" && (TOKEN_TIERS as readonly string[]).includes(v);
}

/** A wallet's tier from its balances. A zero threshold never matches on a zero balance. */
export function tierFor(b: TokenBalances, t: TierThresholds): TokenTier {
  const mimir = Number.isFinite(b.mimir) ? b.mimir : 0;
  const ansem = Number.isFinite(b.ansem) ? b.ansem : 0;
  const at = (min: number) => mimir > 0 && mimir >= min;
  let tier: TokenTier = "none";
  if (at(t.holder)) tier = "holder";
  if (at(t.backer)) tier = "backer";
  if (at(t.oracleCircle)) tier = "oracle-circle";
  if (tier === "none" && t.ansemHolderMin > 0 && ansem >= t.ansemHolderMin) tier = "holder";
  return tier;
}

/** How many times the base rate limit a tier gets on the council APIs. */
export const TIER_RATE_MULTIPLIER: Record<TokenTier, number> = {
  none: 1,
  holder: 2,
  backer: 4,
  "oracle-circle": 8,
};

export function rateLimitFor(base: number, tier: TokenTier): number {
  return Math.max(1, Math.floor(base * TIER_RATE_MULTIPLIER[tier]));
}

// ── Gates ────────────────────────────────────────────────────────────────────

export interface HoldingGate {
  /** MIMIR needed. 0 = this path is off. */
  minMimir: number;
  /** $ANSEM needed. 0 = this path is off. */
  minAnsem: number;
}

/** A gate with both paths off does nothing. */
export function gateEnabled(g: HoldingGate): boolean {
  return g.minMimir > 0 || g.minAnsem > 0;
}

/** Either path passes: enough MIMIR, or enough $ANSEM. */
export function meetsGate(b: TokenBalances, g: HoldingGate): boolean {
  if (!gateEnabled(g)) return true;
  if (g.minMimir > 0 && b.mimir >= g.minMimir) return true;
  if (g.minAnsem > 0 && b.ansem >= g.minAnsem) return true;
  return false;
}

/**
 * BYOA registration anti-spam gate. The MIMIR path only counts once the mint
 * is set, so the gate stays off until launch unless $ANSEM is configured.
 */
export function agentRegisterGateFromEnv(mimirLaunched: boolean, env: Env = process.env): HoldingGate {
  return {
    minMimir: mimirLaunched ? num(env, "AGENT_REGISTER_MIN_MIMIR", 0) : 0,
    minAnsem: num(env, "AGENT_REGISTER_MIN_ANSEM", 0),
  };
}

/** Minimum tier to compose a basket; "none" (the default) = open to all. */
export function basketMinTierFromEnv(mimirLaunched: boolean, env: Env = process.env): TokenTier {
  const raw = env.BASKET_CREATE_MIN_TIER?.trim().toLowerCase();
  if (!mimirLaunched || !isTokenTier(raw)) return "none";
  return raw;
}
