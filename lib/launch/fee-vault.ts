// Mimir Launch: pump.fun creator-fee vault lookup (from snipad worker/fee-vault.ts). Node-only (web3.js + Buffer), kept apart from ./fees.ts so
// the pure fee math can be imported by the Next page and Convex V8 code.
import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/**
 * pump.fun keeps a creator's bonding-curve fees in PDA ["creator-vault", creator] (unverified against the IDL). A wrong
 * PDA reads 0, not null, so lib/launch/fees.ts treats a 0 read like an unknown one and claims on the 24h schedule.
 * Not read here: PumpSwap's coin-creator vault for graduated tokens (no lookup in snipad either); those fees are still
 * collected by that daily claim (claimCreatorFees takes curve + PumpSwap).
 */
export const creatorVault = (creator: string) => PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(creator).toBuffer()], PUMP_PROGRAM)[0];

/** Lamports waiting in `creator`'s vault. */
export const vaultBalance = async (connection: Connection, creator: string): Promise<bigint> => BigInt(await connection.getBalance(creatorVault(creator), "confirmed"));
