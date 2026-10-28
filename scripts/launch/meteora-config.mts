/**
 * Mimir Launch on Meteora: make Mimir's own Dynamic Bonding Curve config, once. Every Meteora agent's pool is created
 * from it (lib/launch/solana/meteora.ts); set the printed address as LAUNCH_METEORA_CONFIG on Vercel and Convex.
 *
 *   node --import tsx scripts/launch/meteora-config.mts [--keypair <path>] [--send]
 *
 * Without --send it only builds and checks the config. The payer (default ~/.config/solana/id.json) needs ~0.02 SOL.
 * The curve: 1B supply (6 dp), SOL quote, 1% trading fee of which the creator (the agent) gets the whole
 * partner/creator share (Mimir's cut comes out of the claim, lib/launch/fees.ts, as with pump.fun), graduation at
 * 85 SOL to DAMM v2 with the LP permanently locked to the creator. Fee claimer and leftover go to the Launch treasury.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ActivationType, BaseFeeMode, buildCurve, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption, MigrationOption, TokenAuthorityOption, TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";

const TREASURY = new PublicKey(process.env.LAUNCH_SOLANA_TREASURY ?? "4aZvr5rReMZVp3NkAa31SaoXRRHGgVChbpaF5MyWTiy7");
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const send = process.argv.includes("--send");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg("--keypair") ?? join(homedir(), ".config/solana/id.json"), "utf8"))));
const conn = new Connection(process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com", "confirmed");

const curve = buildCurve({
  token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: 6, tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
  fee: {
    baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
    dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 100, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
  },
  migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps100, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
  liquidityDistribution: { partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 0, creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 100 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp,
  percentageSupplyOnMigration: 20,
  migrationQuoteThreshold: 85,
});

const config = Keypair.generate();
const client = new DynamicBondingCurveClient(conn, "confirmed");
const tx = await client.partner.createConfig2({
  payer: payer.publicKey, config: config.publicKey, feeClaimer: TREASURY, leftoverReceiver: TREASURY, quoteMint: NATIVE_MINT, ...curve, transferFeeParameters: null,
});
console.log(`payer ${payer.publicKey.toBase58()} (${(await conn.getBalance(payer.publicKey)) / 1e9} SOL), config ${config.publicKey.toBase58()}, ${tx.instructions.length} instruction(s)`);
if (!send) {
  console.log("Built and checked. Re-run with --send to create it on mainnet.");
} else {
  const sig = await sendAndConfirmTransaction(conn, tx, [payer, config], { commitment: "confirmed" });
  console.log(`created: ${sig}\nLAUNCH_METEORA_CONFIG=${config.publicKey.toBase58()}`);
}
