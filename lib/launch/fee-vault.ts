// Mimir Launch: what a creator's pump.fun fees add up to before a claim. Node-only (web3.js + Buffer), kept apart from
// ./fees.ts so the pure fee math can be imported by the Next page and Convex V8 code.
//
// Both vaults are read from the programs' on-chain IDLs (checked 2026-10-13):
//   pump.fun bonding curve  collect_creator_fee       creator_vault = PDA(["creator-vault", creator], pump)      SOL lamports
//   PumpSwap (graduated)    collect_coin_creator_fee  authority = PDA(["creator_vault", coin_creator], pumpswap) WSOL in its ATA
// claimCreatorFees collects both in one go (PumpPortal "collectCreatorFee").
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMPSWAP_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

export const creatorVault = (creator: string) => PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(creator).toBuffer()], PUMP_PROGRAM)[0];

/** PumpSwap's coin-creator fee account: the WSOL ATA of PDA ["creator_vault", creator]. */
export const swapCreatorVaultAta = (creator: string) => {
  const authority = PublicKey.findProgramAddressSync([Buffer.from("creator_vault"), new PublicKey(creator).toBuffer()], PUMPSWAP_PROGRAM)[0];
  return getAssociatedTokenAddressSync(NATIVE_MINT, authority, true, TOKEN_PROGRAM_ID);
};

/** Lamports waiting for `creator` across the curve vault and the PumpSwap vault. A missing PumpSwap account is 0 (never graduated). */
export async function vaultBalance(connection: Connection, creator: string): Promise<bigint> {
  const [curve, swap] = await Promise.all([
    connection.getBalance(creatorVault(creator), "confirmed"),
    connection.getTokenAccountBalance(swapCreatorVaultAta(creator), "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n),
  ]);
  return BigInt(curve) + swap;
}
