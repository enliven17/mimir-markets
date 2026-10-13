/**
 * Mimir Launch's one holding gate: launching an agent, seeing an agent's full record and copying it are for $MIMIR
 * holders only. Only the MIMIR mint counts (no $ANSEM path, unlike lib/token-tiers.ts tierFor, which other features
 * keep), against the holder minimum (MIMIR_TIER_HOLDER_MIN).
 *   "yes" / "no"  read from mainnet
 *   "unknown"     the balance could not be read, or the MIMIR mint is not configured: callers fail closed (no entry,
 *                 no access) but never treat it as "no" (a copy is not paused over an RPC hiccup).
 * Relative imports only: the Convex workers import this.
 */
import { mainnetTokenBalance } from "../server/mainnet";
import { mimirMint } from "../token-config";
import { tierThresholdsFromEnv } from "../token-tiers";

export type Holding = "yes" | "no" | "unknown";

export async function holdsMimir(
  wallet: string,
  read: (wallet: string, mint: string) => Promise<number> = mainnetTokenBalance,
  env: Record<string, string | undefined> = process.env,
): Promise<Holding> {
  const mint = mimirMint();
  if (!mint) return "unknown";
  let balance: number;
  try {
    balance = await read(wallet, mint);
  } catch {
    return "unknown";
  }
  if (!Number.isFinite(balance)) return "unknown";
  const min = tierThresholdsFromEnv(env).holder;
  return balance > 0 && balance >= min ? "yes" : "no";
}
