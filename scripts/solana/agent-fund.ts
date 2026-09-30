/**
 * Make a wallet ER-ready: sweep the USDC sitting in its token account
 * (funded via https://faucet.circle.com → Solana Devnet) into the Mimir
 * vault and delegate the balance PDA to the MagicBlock ER.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/agent-fund.ts [keypairPath] [usdcAmount]
 * Defaults: the solana CLI keypair, full token-account balance.
 */
import { Connection, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MimirSolanaClient } from "../../lib/solana/client";
import { SOLANA_RPC, USDC_MINT, toUsdcUnits, fromUsdcUnits } from "../../lib/solana/config";

const DEFAULT_PATH =
  process.env.SOLANA_KEYPAIR ||
  join(homedir(), ".config", "solana", "talos-deploy.json");

async function main() {
  const targetPath = process.argv[2] || DEFAULT_PATH;
  const requested = process.argv[3] ? Number(process.argv[3]) : null;

  const connection = new Connection(SOLANA_RPC, "confirmed");
  const target = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(targetPath, "utf8")))
  );
  const client = new MimirSolanaClient(target);

  const ataAddress = getAssociatedTokenAddressSync(USDC_MINT, target.publicKey, true);
  let available = 0n;
  try {
    available = BigInt((await getAccount(connection, ataAddress)).amount.toString());
  } catch {
    console.error(
      `No USDC token account for ${target.publicKey.toBase58()}.\n` +
        `Fund it first: https://faucet.circle.com → Solana Devnet → ${target.publicKey.toBase58()}`
    );
    process.exit(1);
  }

  const amount = requested ? toUsdcUnits(requested) : available;
  if (amount === 0n || available < amount) {
    console.error(
      `Insufficient USDC: have ${fromUsdcUnits(available)}, want ${fromUsdcUnits(amount)}. ` +
        `Top up via faucet.circle.com → ${target.publicKey.toBase58()}`
    );
    process.exit(1);
  }

  console.log(`Sweeping ${fromUsdcUnits(amount)} USDC into the Mimir vault...`);
  const dep = await client.deposit(amount);
  console.log("✓ deposited:", dep);

  const del = await client.delegateBalance();
  console.log("✓ balance PDA delegated to MagicBlock ER:", del);

  const bal = await client.getBalance();
  console.log(`Done. ER-ready virtual balance: ${fromUsdcUnits(bal)} USDC`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
