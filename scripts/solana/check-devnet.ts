/** Read-only check. Never loads a signer or changes program state. */
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { getAccount, getMint, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deployment } from "../../config/solana-devnet.cjs";
import publicRoster from "../../config/solana-roster.json";
import { MimirSolanaClient } from "../../lib/solana/client";
import { MIMIR_PROGRAM_ID, USDC_MINT, configPda, vaultPda, explorerUrl } from "../../lib/solana/config";

async function main() {
  const client = new MimirSolanaClient(Keypair.generate());
  const [program, config, mint, erSlot] = await Promise.all([
    client.baseConnection.getAccountInfo(MIMIR_PROGRAM_ID),
    client.getConfig(),
    getMint(client.baseConnection, USDC_MINT),
    client.erConnection.getSlot("confirmed"),
  ]);
  assert(program?.executable, "Mimir program is not executable");
  assert(config, "Mimir program has not been initialized");
  assert(config.usdcMint.equals(USDC_MINT), "On-chain settlement mint differs from the devnet app");
  assert.equal(mint.decimals, 6);
  const claims = await client.getAllClaims();
  const councilAddresses = new Set(Object.values(publicRoster.council));
  const vault = await getAccount(client.baseConnection, vaultPda());
  assert(vault.mint.equals(USDC_MINT), "Vault mint mismatch");
  const oracleAta = getAssociatedTokenAddressSync(USDC_MINT, config.oracle);
  const [oracleLamports, oracleUsdc] = await Promise.all([
    client.baseConnection.getBalance(config.oracle),
    client.baseConnection.getTokenAccountBalance(oracleAta).catch(() => null),
  ]);
  console.log(JSON.stringify({
    network: deployment.cluster,
    genesisHash: deployment.genesisHash,
    program: MIMIR_PROGRAM_ID.toBase58(),
    programExplorer: explorerUrl("address", MIMIR_PROGRAM_ID.toBase58()),
    config: configPda().toBase58(),
    usdcMint: USDC_MINT.toBase58(),
    vault: vaultPda().toBase58(),
    vaultUsdc: Number(vault.amount) / 1e6,
    claimCount: config.claimCount.toString(),
    totalResolved: config.totalResolved.toString(),
    readableClaims: claims.length,
    readableResolvedClaims: claims.filter((claim) => claim.state === 2).length,
    recognizedCouncilPositions: claims.reduce((sum, claim) => sum + claim.challengers.filter((challenger) => councilAddresses.has(challenger.addr.toBase58())).length, 0),
    paused: config.paused,
    disputeWindowSeconds: config.disputeWindow,
    resolutionGraceSeconds: config.resolutionGrace,
    admin: config.admin.toBase58(),
    oracle: config.oracle.toBase58(),
    oracleSol: oracleLamports / 1e9,
    oracleWalletUsdc: oracleUsdc?.value.uiAmount ?? 0,
    erSlot,
    site: deployment.siteUrl,
  }, null, 2));
  if (config.paused) process.exitCode = 1;
}

main().catch((error) => {
  // RPC provider URLs can carry secrets; do not print transport errors verbatim.
  console.error(error instanceof assert.AssertionError ? error.message : "Solana devnet check failed. Check RPC availability and deployment configuration.");
  process.exitCode = 1;
});
