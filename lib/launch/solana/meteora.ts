// Meteora DBC (Dynamic Bonding Curve): an agent's token on Mimir's own curve config (LAUNCH_METEORA_CONFIG, made once
// by scripts/launch/meteora-config.mts: SOL quote, the creator gets the whole partner/creator share of the trading fee,
// graduation to DAMM v2). The agent wallet creates the pool as its creator and claims its creator trading fees; trades
// of the token route through Jupiter like any non-pump.fun token.
//
// SDK: @meteora-ag/dynamic-bonding-curve-sdk 2.0.0 (verified 2026-10-28, docs.md in the package):
//   creator.createPoolTx -> one top-level DBC instruction, signed by payer + baseMint keypair + poolCreator.
//   creator.claimCreatorTradingFee -> fee in quote (SOL) unwrapped to `receiver`.
import { BN } from "@coral-xyz/anchor";
import { DynamicBondingCurveClient, deriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";

import { assertAddress, SolanaError } from "./util";

export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const U64_MAX = new BN("18446744073709551615");
const CU_LIMIT = 300_000;
const CU_PRICE_MICROLAMPORTS = 50_000; // 300k CU x 0.05 lamports = 15,000 lamports priority fee

/** The pool's create/claim instructions as an unsigned v0 tx; the submitter fills in the blockhash. */
function v0(payer: string, ixs: TransactionMessage["instructions"]): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: new PublicKey(payer),
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICROLAMPORTS }), ...ixs],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function createMeteora(o: { connection: Connection; config: string }) {
  const config = new PublicKey(assertAddress("LAUNCH_METEORA_CONFIG", o.config));
  const client = new DynamicBondingCurveClient(o.connection, "confirmed");
  const pool = (mint: string) => deriveDbcPoolAddress(NATIVE_MINT, new PublicKey(assertAddress("mint", mint)), config);

  return {
    config: config.toBase58(),
    pool: (mint: string) => pool(mint).toBase58(),

    async buildCreateTx(a: { creator: string; mint: string; name: string; symbol: string; metadataUri: string }): Promise<VersionedTransaction> {
      const creator = new PublicKey(assertAddress("creator", a.creator));
      const tx = await client.creator.createPool({ baseMint: new PublicKey(a.mint), config, name: a.name, symbol: a.symbol, uri: a.metadataUri, payer: creator, poolCreator: creator });
      return v0(a.creator, tx.instructions);
    },

    async buildClaimTx(a: { wallet: string; mint: string }): Promise<VersionedTransaction> {
      const w = new PublicKey(assertAddress("wallet", a.wallet));
      const tx = await client.creator.claimCreatorTradingFee({ creator: w, payer: w, pool: pool(a.mint), maxBaseAmount: new BN(0), maxQuoteAmount: U64_MAX, receiver: w });
      return v0(a.wallet, tx.instructions);
    },

    /** Unclaimed creator fees in lamports; null when the pool cannot be read. */
    async accrued(mint: string): Promise<bigint | null> {
      // The SDK's VirtualPool type resolves against its own anchor copy here; the field is documented (docs.md getPool).
      const p = (await client.state.getPool(pool(mint)).catch(() => null)) as { creatorQuoteFee: { toString(): string } } | null;
      return p ? BigInt(p.creatorQuoteFee.toString()) : null;
    },
  };
}

export type Meteora = ReturnType<typeof createMeteora>;

export function meteoraFromEnv(connection: Connection, env: Record<string, string | undefined> = process.env): Meteora | null {
  const config = env.LAUNCH_METEORA_CONFIG?.trim();
  if (!config) return null;
  try {
    return createMeteora({ connection, config });
  } catch (e) {
    throw new SolanaError("meteora", `LAUNCH_METEORA_CONFIG: ${(e as Error).message}`, { code: "CONFIG" });
  }
}
