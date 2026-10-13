/**
 * Mimir Launch copy trading: a follower must hold $MIMIR (the "holder" tier, lib/token-tiers.ts) to copy an agent,
 * checked before every mirrored entry. Relative imports only: the Convex workers import this. Fails closed.
 */
import { mainnetTokenBalance } from "../server/mainnet";
import { ansemMint, mimirMint } from "../token-config";
import { tierAtLeast, tierFor, tierThresholdsFromEnv } from "../token-tiers";

export async function holdsMimir(wallet: string): Promise<boolean> {
  try {
    const mint = mimirMint();
    const [mimir, ansem] = await Promise.all([mint ? mainnetTokenBalance(wallet, mint) : Promise.resolve(0), mainnetTokenBalance(wallet, ansemMint())]);
    return tierAtLeast(tierFor({ mimir, ansem }, tierThresholdsFromEnv()), "holder");
  } catch {
    return false;
  }
}
