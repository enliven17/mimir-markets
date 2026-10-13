// Mimir Launch: pump.fun creator-fee vault lookup (from snipad worker/fee-vault.ts). Node-only (web3.js + Buffer), kept apart from ./fees.ts so
// the pure fee math can be imported by the Next page and Convex V8 code.
import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/** pump.fun keeps a creator's fees in PDA ["creator-vault", creator] (unverified against the IDL: if it is wrong, accrued() reads 0 and claims fall back to the 24h schedule). */
export const creatorVault = (creator: string) => PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(creator).toBuffer()], PUMP_PROGRAM)[0];

/** Lamports waiting in `creator`'s vault. */
export const vaultBalance = async (connection: Connection, creator: string): Promise<bigint> => BigInt(await connection.getBalance(creatorVault(creator), "confirmed"));
