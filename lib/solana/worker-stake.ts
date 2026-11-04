import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MimirSolanaClient } from "./client";
import { MIMIR_PROGRAM_ID, USDC_MINT, balancePda, feeBalancePda } from "./config";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function freeUsdc(client: MimirSolanaClient): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, client.publicKey);
  const info = await client.baseConnection.getAccountInfo(ata);
  const held = info ? BigInt((await client.baseConnection.getTokenAccountBalance(ata)).value.amount) : 0n;
  return held + await client.getBalance();
}
export async function returnBalanceToBase(client: MimirSolanaClient) {
  if (!(await client.isBalanceDelegated())) return;
  await client.undelegateBalance();
  for (let i = 0; i < 25; i++) { if (!(await client.isBalanceDelegated())) return; await wait(750); }
  throw new Error("Balance is still returning from the rollup");
}
/** Market creation spends the wallet ATA, so recover only the missing liquid USDC. */
export async function ensureWalletUsdc(client: MimirSolanaClient, amount: bigint): Promise<void> {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, client.publicKey);
  const held = await client.baseConnection.getTokenAccountBalance(ata).then(r => BigInt(r.value.amount)).catch(() => 0n);
  if (held >= amount) return;
  await returnBalanceToBase(client);
  const deficit = amount - held;
  if (await client.getBalance() < deficit) throw new Error("Insufficient free test USDC");
  await client.withdraw(deficit);
}
/** Duplicate and capacity checks happen before a deposit or signature. */
export async function stakeNative(client: MimirSolanaClient, id: bigint, amount: bigint, agent: PublicKey | null = null): Promise<string> {
  const claim = await client.getClaim(id);
  const now = Math.floor(Date.now() / 1000);
  if (!claim || claim.state > 1 || claim.deadline - 60 <= now || claim.creator.equals(client.publicKey)) throw new Error("Market is not open for this wallet");
  if (claim.challengers.some(p => p.addr.equals(client.publicKey))) throw new Error("Wallet already has a position");
  if (amount < 2_000_000n || claim.totalChallengerStake + amount > claim.creatorStake * 5n || claim.challengers.length >= (claim.maxChallengers || 16)) throw new Error("Stake exceeds the program limits");
  if (agent && !(await client.baseConnection.getAccountInfo(feeBalancePda(agent)))) await client.openFeeAccount(agent);
  const free = await client.getBalance();
  if (free < amount) { await returnBalanceToBase(client); await client.deposit(amount - free); }
  if (await client.isDelegated(id)) {
    if (!(await client.isBalanceDelegated())) {
      await client.delegateBalance();
      for (let i = 0; i < 25; i++) {
        const info = await client.erConnection.getAccountInfo(balancePda(client.publicKey));
        if (info?.owner.equals(MIMIR_PROGRAM_ID)) break;
        await wait(750);
      }
    }
    return client.challengeClaimER(id, amount, agent);
  }
  await returnBalanceToBase(client);
  return client.challengeClaimBase(id, amount, agent);
}
