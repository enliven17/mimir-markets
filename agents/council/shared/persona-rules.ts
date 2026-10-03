/**
 * Pure council rules: no LLM, no RPC, unit-tested.
 *
 *   - Contrarian and Whale-Watcher evaluators (they react to pool state only)
 *   - exact category matching for specialists
 *   - Kelly stake sizing at real pool odds against the persona's ER bankroll
 *   - the rule-persona gate: house markets only, off on mainnet by default
 *
 * Personas can only join the challenger pool, so every rule returns either
 * "stake on the challengers" or an abstention.
 */
import { challengerKellyStake } from "../../../lib/kelly";
import { MIN_STAKE_UNITS, fromUsdcUnits, toUsdcUnits } from "../../../lib/solana/config";
import type { PersonaSpec } from "../personas";
import type { CouncilClaim, PersonaDecision } from "./types";

export const DEFAULT_MIN_CONFIDENCE = 75;
export const DEFAULT_STAKE_USDC = 2;
/** Conservative Kelly cap: personas play many markets at once (the oracle uses 0.25). */
export const PERSONA_KELLY_CAP = 0.15;
/** No single stake above this share of the bankroll, whatever Kelly says. */
export const MAX_BANKROLL_SHARE = 0.1;
/**
 * A stake never exceeds this multiple of the creator's stake: past it the
 * persona mostly dilutes its own share of the creator's money.
 */
export const PERSONA_MAX_CREATOR_MULTIPLE = Number(process.env.COUNCIL_MAX_CREATOR_MULTIPLE ?? "1");

const usdc = (units: bigint) => fromUsdcUnits(units).toFixed(2);

/**
 * Specialists only consider claims whose category EQUALS one of their tags
 * (case-insensitive). Substring matching let "crypto-maxi" trade a
 * "cryptography" claim it would then refuse to judge; the jury
 * (agents/oracle/council-vote.ts) and preflight use this same rule.
 */
export function categoryMatches(persona: Pick<PersonaSpec, "categoryFilter">, category: string): boolean {
  if (!persona.categoryFilter || persona.categoryFilter.length === 0) return true;
  const c = (category ?? "").trim().toLowerCase();
  return persona.categoryFilter.some((tag) => c === tag.toLowerCase());
}

/**
 * Contrarian: stake against the larger pool. Since personas can only join the
 * challengers, that means staking when the creator holds at least 60% of the
 * pot, and never before anyone has challenged (the creator's opening stake is
 * a baseline, not crowd sentiment).
 */
export function evaluateContrarian(persona: PersonaSpec, claim: CouncilClaim): PersonaDecision {
  const stakeUsdc = persona.stakeUsdc ?? DEFAULT_STAKE_USDC;
  const creator = claim.creatorStake;
  const challenger = claim.totalChallengerStake;
  if (challenger === 0n) {
    return {
      shouldStake: false,
      stakeUsdc: 0,
      rationale: "Contrarian abstains: no challenger pool yet to bet against.",
      skipReason: "no-pool-imbalance",
    };
  }
  const total = creator + challenger;
  const creatorShare = total > 0n ? Number((creator * 100n) / total) : 50;
  if (creatorShare >= 60) {
    return {
      shouldStake: true,
      stakeUsdc,
      rationale: `Contrarian: the creator holds ${creatorShare}% of the pool. The crowd leans hard one way, so I take the other side.`,
    };
  }
  return {
    shouldStake: false,
    stakeUsdc: 0,
    rationale: `Contrarian abstains: the pool is balanced (creator ${creatorShare}%), nothing to react against.`,
    skipReason: "no-pool-imbalance",
  };
}

/**
 * Whale-Watcher: follow the single largest staker. If that is a challenger,
 * stake with them; if it is the creator, abstain (personas can't join the
 * creator side).
 */
export function evaluateWhaleWatcher(persona: PersonaSpec, claim: CouncilClaim): PersonaDecision {
  const stakeUsdc = persona.stakeUsdc ?? DEFAULT_STAKE_USDC;
  const biggest = claim.challengers.reduce((m, c) => (c.stake > m ? c.stake : m), 0n);
  if (biggest === 0n) {
    return {
      shouldStake: false,
      stakeUsdc: 0,
      rationale: "Whale-Watcher waits: no challenger has staked yet, no whale to follow.",
      skipReason: "no-whale-yet",
    };
  }
  if (biggest > claim.creatorStake) {
    return {
      shouldStake: true,
      stakeUsdc,
      rationale: `Whale-Watcher: the largest single stake is a challenger's (${usdc(biggest)} USDC vs the creator's ${usdc(claim.creatorStake)}). I follow the whale.`,
    };
  }
  return {
    shouldStake: false,
    stakeUsdc: 0,
    rationale: `Whale-Watcher abstains: the biggest single staker is the creator (${usdc(claim.creatorStake)} USDC). I can't join that side, so I sit out.`,
    skipReason: "abstain-agrees-with-creator",
  };
}

/** Rule-based decision for a persona with a ruleEvaluator; null for LLM personas. */
export function ruleDecision(persona: PersonaSpec, claim: CouncilClaim): PersonaDecision | null {
  if (persona.archetype !== "rule-based") return null;
  if (persona.ruleEvaluator === "contrarian") return evaluateContrarian(persona, claim);
  if (persona.ruleEvaluator === "whale-follow") return evaluateWhaleWatcher(persona, claim);
  return {
    shouldStake: false,
    stakeUsdc: 0,
    rationale: `${persona.displayName} has no rule evaluator wired.`,
    skipReason: "abstain-low-confidence",
  };
}

/**
 * Rule personas (contrarian, whale-watcher) read nothing but the pool, so a
 * sock-puppet challenger can steer them into any market (audit P2-4). They
 * only act on markets the house creator opened, and stay off on mainnet
 * unless COUNCIL_RULE_PERSONAS_MAINNET=1. Null: no gate applies.
 */
export function rulePersonaGate(
  persona: Pick<PersonaSpec, "archetype" | "displayName">,
  claim: Pick<CouncilClaim, "creator">,
  opts: { houseCreator: string | null; mainnet: boolean; mainnetOverride: boolean },
): PersonaDecision | null {
  if (persona.archetype !== "rule-based") return null;
  const off = (why: string): PersonaDecision => ({
    shouldStake: false,
    stakeUsdc: 0,
    rationale: `${persona.displayName} sits out: ${why}`,
    skipReason: "rule-persona-gated",
  });
  if (opts.mainnet && !opts.mainnetOverride) return off("rule personas are off on mainnet.");
  if (!opts.houseCreator || claim.creator.toBase58() !== opts.houseCreator) {
    return off("rule personas only trade markets the house opened.");
  }
  return null;
}

/**
 * Stake size in USDC base units. null: the bankroll can't cover the base
 * stake. 0n: no stake at this pool's odds is worth making.
 *
 *   base  = max(spec stake, program MIN_STAKE)
 *   need  = 2 × base in the bankroll, so a persona never drains to zero
 *   LLM personas (with a confidence): Kelly at the real pool odds a
 *   challenger gets, b = creatorStake / (challengerPool + stake)
 *   (lib/kelly.ts challengerKellyStake), capped at 15% Kelly, at
 *   PERSONA_MAX_CREATOR_MULTIPLE × the creator's stake and at 10% of the
 *   bankroll; base when Kelly wants less but base is still +EV, else 0n.
 *   Rule personas stake base.
 */
export function sizeStakeUnits(args: {
  baseUsdc: number | undefined;
  confidence?: number;
  bankrollUnits: bigint;
  creatorStakeUnits?: bigint;
  totalChallengerStakeUnits?: bigint;
  maxCreatorMultiple?: number;
}): bigint | null {
  const floor = toUsdcUnits(Math.max(args.baseUsdc ?? DEFAULT_STAKE_USDC, 0));
  const base = floor > MIN_STAKE_UNITS ? floor : MIN_STAKE_UNITS;
  if (args.bankrollUnits < base * 2n) return null;
  if (args.confidence === undefined) return base;
  const bankroll = fromUsdcUnits(args.bankrollUnits);
  const stake = challengerKellyStake({
    confidencePct: args.confidence,
    cap: PERSONA_KELLY_CAP,
    bankroll,
    creatorStake: fromUsdcUnits(args.creatorStakeUnits ?? 0n),
    totalChallengerStake: fromUsdcUnits(args.totalChallengerStakeUnits ?? 0n),
    maxCreatorMultiple: args.maxCreatorMultiple ?? PERSONA_MAX_CREATOR_MULTIPLE,
    minStake: fromUsdcUnits(base),
  });
  if (!(stake > 0)) return 0n;
  const sized = Math.min(stake, bankroll * MAX_BANKROLL_SHARE);
  const units = toUsdcUnits(Math.floor(sized * 100) / 100);
  return units > base ? units : base;
}
