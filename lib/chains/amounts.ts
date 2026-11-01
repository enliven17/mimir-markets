/**
 * The amount convention (lib/chains/registry.ts): off chain, every USDC amount is an 18-dp integer ("index units",
 * wei-like, a decimal string in Convex), whatever chain it came from. On chain, Arc takes 18 dp (native USDC) and Base
 * takes 6 dp (ERC-20 USDC).
 *
 *   toIndexUnits     chain → index: exact (Base ×1e12). The indexer applies it to every amount it reads.
 *   toChainUnits     index → chain: exact or it throws SubUnitAmountError. Every transaction builder uses it, so a
 *                    stake can never silently send less (or more) than what the user saw.
 *   floorToChain     index → index, rounded DOWN to what the chain can carry: for computed amounts (a max that fits,
 *                    a Kelly size) before they reach a builder. The dust stays with the user.
 */
import type { MarketChain } from "./registry";

export const INDEX_DECIMALS = 18;

type HasUsdc = { usdc: Pick<MarketChain["usdc"], "decimals"> };

/** How many index units one on-chain unit is: 1 on Arc, 1e12 on Base. */
export const unitScale = (chain: HasUsdc): bigint => 10n ** BigInt(INDEX_DECIMALS - chain.usdc.decimals);

export class SubUnitAmountError extends Error {
  constructor(public readonly amount: bigint, public readonly decimals: number) {
    super(`USDC on this chain has ${decimals} decimals: ${amount} index units is not a whole number of them`);
  }
}

export function toIndexUnits(chain: HasUsdc, raw: bigint): bigint {
  return raw * unitScale(chain);
}

export function toChainUnits(chain: HasUsdc, wei: bigint): bigint {
  const scale = unitScale(chain);
  if (wei % scale !== 0n) throw new SubUnitAmountError(wei, chain.usdc.decimals);
  return wei / scale;
}

export function floorToChain(chain: HasUsdc, wei: bigint): bigint {
  const scale = unitScale(chain);
  return (wei / scale) * scale;
}

/** A raw on-chain amount (bigint or decimal string) as an index-unit decimal string, for Convex rows. */
export const indexString = (chain: HasUsdc, raw: bigint | string): string => toIndexUnits(chain, BigInt(raw)).toString();

/** Index units → a USDC number (display, sorting, agent sizing). */
export const indexToUsd = (wei: bigint | string): number => Number(BigInt(wei)) / 1e18;

/** A USDC number → index units, rounded down to 6 decimals (USDC's precision on every chain). */
export function usdToIndex(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.floor(usd * 1e6)) * 1_000_000_000_000n;
}

/** Index units → the 6-dp decimal string Circle's API takes ("2.5"), exact to the micro-USDC (rounded down). */
export function indexToDecimal6(wei: bigint): string {
  const micro = wei / 1_000_000_000_000n;
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
