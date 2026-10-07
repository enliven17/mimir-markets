/**
 * Paying to deploy an agent on Arc: $1, $0.50 for 5M+ $MIMIR, free for 10M+
 * (lib/arc/fee-tiers.ts), the tier read from the owner's Solana wallet. The
 * owner pays by sending native USDC on Arc to the market contracts' fee
 * recipient; the registration names that transaction, and each one pays for
 * one agent only (an agent_payments row per tx hash).
 */
import { parseAbi, parseEther, parseEventLogs, type Hex } from "viem";

import { AgentEnvelopeError } from "@/lib/agents/api";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC, ARC_USDC as USDC } from "@/lib/arc/config";

const ARC_USDC = USDC.toLowerCase();
const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
import { AGENT_DEPLOY_USD, feeTierFor, type FeeTier } from "@/lib/arc/fee-tiers";
import { insert, store } from "./store";
import { walletBalances } from "./holder";

export async function deployPriceFor(ownerWallet: string): Promise<{ tier: FeeTier; wei: bigint }> {
  const mimir = await walletBalances(ownerWallet).then((b) => b.mimir).catch(() => 0);
  const tier = feeTierFor(mimir);
  return { tier, wei: parseEther(String(AGENT_DEPLOY_USD[tier])) };
}

/** Where deploy payments go: MimirV3's fee recipient, read from the contract so it follows its timelocked changes. */
export async function treasury(): Promise<`0x${string}`> {
  const v3 = ARC.contracts.mimirV3;
  if (!v3) throw new AgentEnvelopeError("Arc contracts are not configured", 503, "chain_unavailable");
  return arcPublicClient().readContract({ address: v3, abi: parseAbi(["function feeRecipient() view returns (address)"]), functionName: "feeRecipient" });
}

/**
 * Throws unless `txHash` paid at least `minWei` to the treasury from one of `payers` (the owner's bound Arc account
 * or the agent's Arc operator) and has not paid for an agent before. The payment is a USDC ERC-20 transfer
 * (0x3600…, 6 dp: the same balance as native USDC), so its Transfer log proves who paid whom even when a passkey
 * account sends it through the bundler; a plain native transfer from an EOA payer is accepted too.
 */
export async function verifyDeployPayment(txHash: unknown, minWei: bigint, payers: string[]): Promise<Hex> {
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new AgentEnvelopeError("paymentTx (the Arc transaction that paid the deploy fee) is required", 402, "payment_required");
  }
  const hash = txHash.toLowerCase() as Hex;
  if (await store().get("agent_payments", hash)) throw new AgentEnvelopeError("that payment already paid for another agent", 409, "payment_used");
  const allowed = new Set(payers.filter(Boolean).map((a) => a.toLowerCase()));
  const client = arcPublicClient();
  const [tx, receipt, to] = await Promise.all([
    client.getTransaction({ hash }).catch(() => null),
    client.getTransactionReceipt({ hash }).catch(() => null),
    treasury(),
  ]);
  if (!tx || !receipt || receipt.status !== "success") throw new AgentEnvelopeError("the payment transaction was not found or failed", 402, "payment_invalid");
  const treasuryLc = to.toLowerCase();
  const viaToken = parseEventLogs({ abi: TRANSFER_ABI, logs: receipt.logs, eventName: "Transfer" }).some(
    (l) => l.address.toLowerCase() === ARC_USDC && l.args.to.toLowerCase() === treasuryLc && allowed.has(l.args.from.toLowerCase()) && l.args.value * 1_000_000_000_000n >= minWei,
  );
  const native = tx.to?.toLowerCase() === treasuryLc && allowed.has(tx.from.toLowerCase()) && tx.value >= minWei;
  if (!viaToken && !native) {
    throw new AgentEnvelopeError(`the payment must send at least ${minWei} wei of USDC to ${to} from the owner's Arc account or the agent's Arc operator`, 402, "payment_invalid");
  }
  return hash;
}

/** Records the payment; throws when the same tx was recorded for another agent in the meantime (it pays once). */
export async function recordDeployPayment(hash: Hex, agentId: string, ownerWallet: string, amountWei: bigint): Promise<void> {
  const now = Date.now();
  const fresh = await insert("agent_payments", hash, { tx_hash: hash, agent_id: agentId, owner_wallet: ownerWallet, amount_wei: amountWei.toString(), paid_at: now }, { i1: agentId, at: now });
  if (!fresh) throw new AgentEnvelopeError("that payment already paid for another agent", 409, "payment_used");
}
