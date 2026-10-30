// Entry sizing. Every guard returns 0 with a human reason; `pause` asks the caller to pause the
// agent (daily loss cap). Never sizes above what the wallet can actually spend.
import type { RiskParams } from "../types";
import { fmtSol, LAMPORTS_PER_SOL, mulBps, pctToBps } from "./sol";

export const MIN_TRADE_LAMPORTS = LAMPORTS_PER_SOL / 100n; // 0.01 SOL
export const DEFAULT_MAX_OPEN = 3;

export type SizeInput = {
  spendable: bigint;
  /** Equity at the start of the UTC day (the daily loss cap is a % of this). */
  bankrollLamports: bigint;
  risk: RiskParams;
  /** Realised PnL since UTC midnight, lamports (negative = loss). */
  dailyPnl: bigint;
  openPositions: readonly { mint: string }[];
  maxOpen?: number;
  /** Mint about to be bought; refused if already held. */
  mint?: string;
  minLamports?: bigint;
};

export type SizeResult = { lamports: bigint; reason: string; pause: boolean };

const zero = (reason: string, pause = false): SizeResult => ({ lamports: 0n, reason, pause });

/** Size at half the base amount at the safety floor and grow linearly to full size at 100. */
export function safetySized(lamports: bigint, score: number, floor: number | undefined): bigint {
  if (lamports <= 0n || floor === undefined || floor >= 100) return lamports;
  const over = Math.max(0, Math.min(1, (score - floor) / (100 - floor)));
  const scaleBps = BigInt(Math.round((0.5 + 0.5 * over) * 10_000));
  return mulBps(lamports, scaleBps);
}

/** Daily loss cap in lamports; 0 when the cap is disabled or the bankroll is unknown. */
export function dailyLossCap(bankrollLamports: bigint, maxDailyLossPct: number): bigint {
  if (bankrollLamports <= 0n) return 0n;
  return mulBps(bankrollLamports, pctToBps(maxDailyLossPct));
}

/** True once today's realised loss reached the cap (exactly hitting it counts). */
export function dailyCapHit(dailyPnl: bigint, bankrollLamports: bigint, maxDailyLossPct: number): boolean {
  const cap = dailyLossCap(bankrollLamports, maxDailyLossPct);
  return cap > 0n && dailyPnl <= -cap;
}

export function entrySize(input: SizeInput): SizeResult {
  const { spendable, bankrollLamports, risk, dailyPnl, openPositions, mint } = input;
  const maxOpen = input.maxOpen ?? DEFAULT_MAX_OPEN;
  const min = input.minLamports ?? MIN_TRADE_LAMPORTS;

  if (dailyCapHit(dailyPnl, bankrollLamports, risk.maxDailyLossPct)) {
    const cap = dailyLossCap(bankrollLamports, risk.maxDailyLossPct);
    return zero(`daily loss cap hit (${fmtSol(dailyPnl)} SOL today, cap -${fmtSol(cap)} SOL)`, true);
  }
  if (mint && openPositions.some((p) => p.mint === mint)) return zero("already holding this token");
  if (openPositions.length >= maxOpen) return zero(`max ${maxOpen} open positions reached`);
  if (spendable <= 0n) return zero("no spendable SOL");

  const bps = pctToBps(risk.positionPct);
  if (bps === 0n) return zero("position size is 0%");
  const base = bankrollLamports > 0n ? bankrollLamports : spendable;
  let lamports = mulBps(base, bps);
  if (lamports > spendable) lamports = spendable;
  if (lamports < min) return zero(`size ${fmtSol(lamports)} SOL below minimum ${fmtSol(min)} SOL`);
  return { lamports, reason: `${risk.positionPct}% of ${fmtSol(base)} SOL bankroll`, pause: false };
}

/**
 * Smallest spendable balance at which entrySize (no open positions, today's realised `dailyPnl`)
 * returns a trade of at least `min`. Only for messages: the idle check itself calls entrySize, so
 * the agent wakes exactly when it could trade. null when the position size can never reach `min`.
 */
export function minSpendableToTrade(risk: RiskParams, dailyPnl: bigint, min: bigint = MIN_TRADE_LAMPORTS): bigint | null {
  const bps = pctToBps(risk.positionPct);
  if (bps === 0n) return null;
  // The bankroll needed for bps of it to reach min (bankroll = spendable - dailyPnl when flat).
  const k = (min * 10_000n + bps - 1n) / bps;
  // A day's profit at least that large: bankroll <= 0, so entrySize sizes off the spendable itself.
  if (dailyPnl >= k) return k;
  const need = dailyPnl + k;
  return need > min ? need : min;
}
