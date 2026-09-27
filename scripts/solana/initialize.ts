/**
 * One-time program initialization: creates the Config PDA and the USDC
 * vault bound to the configured mint (Circle devnet USDC by default),
 * with the admin keypair as admin, oracle and platform fee recipient.
 *
 * Defaults mirror the MimirV3 deploy: 0.5% platform + 0.5% agent-owner fee on
 * profit only, 24h dispute window, 7-day resolution grace.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/initialize.ts
 * Env: MIMIR_ORACLE (default admin), MIMIR_FEE_RECIPIENT (default admin),
 *      MIMIR_PLATFORM_FEE_BPS (50), MIMIR_AGENT_FEE_BPS (50),
 *      MIMIR_DISPUTE_WINDOW_SECONDS (86400), MIMIR_RESOLUTION_GRACE_SECONDS (604800)
 */
import { PublicKey } from "@solana/web3.js";
import { loadAgentKeypair } from "../../lib/solana/keypair";
import { MimirSolanaClient } from "../../lib/solana/client";
import { USDC_MINT, SOLANA_RPC } from "../../lib/solana/config";
import { validateFeePolicy } from "../../lib/solana/fees";

const envNum = (name: string, fallback: number) => {
  const v = process.env[name]?.trim();
  return v ? Number(v) : fallback;
};

async function main() {
  const admin = loadAgentKeypair();
  const client = new MimirSolanaClient(admin);
  const oracle = new PublicKey(process.env.MIMIR_ORACLE?.trim() || admin.publicKey);
  const feeRecipient = new PublicKey(process.env.MIMIR_FEE_RECIPIENT?.trim() || admin.publicKey);
  const input = {
    oracle,
    feeRecipient,
    platformFeeBps: envNum("MIMIR_PLATFORM_FEE_BPS", 50),
    agentFeeBps: envNum("MIMIR_AGENT_FEE_BPS", 50),
    disputeWindow: envNum("MIMIR_DISPUTE_WINDOW_SECONDS", 86_400),
    resolutionGrace: envNum("MIMIR_RESOLUTION_GRACE_SECONDS", 7 * 86_400),
  };
  validateFeePolicy({
    platformFeeBps: input.platformFeeBps,
    agentOwnerFeeBps: input.agentFeeBps,
    platformRecipient: feeRecipient.toBase58(),
  });

  console.log("Mimir initialize");
  console.log("  program :", client.base.programId.toBase58());
  console.log("  rpc     :", SOLANA_RPC);
  console.log("  mint    :", USDC_MINT.toBase58());
  console.log("  admin   :", admin.publicKey.toBase58());
  console.log("  oracle  :", oracle.toBase58());
  console.log("  fees    :", `${input.platformFeeBps} bps platform → ${feeRecipient.toBase58()}, ${input.agentFeeBps} bps agent owner`);
  console.log("  windows :", `dispute ${input.disputeWindow}s, grace ${input.resolutionGrace}s`);

  const existing = await client.getConfig();
  if (existing) {
    console.log(
      `\nConfig already exists — mint ${existing.usdcMint.toBase58()}, ` +
        `oracle ${existing.oracle.toBase58()}, claims ${existing.claimCount}. Nothing to do.`
    );
    return;
  }

  const sig = await client.initialize(input);
  console.log(`\n✓ Initialized — https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
