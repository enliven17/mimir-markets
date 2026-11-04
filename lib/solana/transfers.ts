"use client";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { SOLANA_RPC, USDC_MINT } from "./config";
import { assertDevnetGenesis, createDevnetConnection } from "./devnet-connection";

export function decimalUnits(value: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m || (m[2]?.length ?? 0) > decimals) throw new Error(`Use a positive amount with at most ${decimals} decimals.`);
  const units = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0"));
  if (units <= 0n) throw new Error("Enter a positive amount.");
  return units;
}
export async function sendWalletTransfer(wallet: WalletContextState, recipient: string, amount: string, asset: "usdc" | "sol"): Promise<string> {
  if (!wallet.publicKey) throw new Error("Connect your Solana wallet first.");
  await assertDevnetGenesis(SOLANA_RPC);
  const connection = createDevnetConnection(SOLANA_RPC), to = new PublicKey(recipient), from = wallet.publicKey;
  const units = decimalUnits(amount, asset === "sol" ? 9 : 6);
  const tx = new Transaction();
  if (asset === "sol") tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: units }));
  else {
    const target = getAssociatedTokenAddressSync(USDC_MINT, to, true);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(from, target, to, USDC_MINT));
    tx.add(createTransferCheckedInstruction(getAssociatedTokenAddressSync(USDC_MINT, from), USDC_MINT, target, from, units, 6));
  }
  const block = await connection.getLatestBlockhash("confirmed"); tx.recentBlockhash = block.blockhash; tx.feePayer = from;
  const signature = await wallet.sendTransaction(tx, connection);
  const confirmed = await connection.confirmTransaction({ ...block, signature }, "confirmed");
  if (confirmed.value.err) throw new Error("The devnet transfer failed.");
  return signature;
}
