/**
 * Market calls from Circle wallets on chains where Circle only signs (generic EVM / EVM-TESTNET: BNB Chain). Circle
 * has no contractExecution there, so each call is: build the tx here (nonce, gas, fee from the chain's RPC) → Circle
 * signs it (POST /developer/sign/transaction, lib/server/circle-w3s.ts) → we broadcast it (eth_sendRawTransaction)
 * and wait for the receipt. The key stays with Circle. Gas is paid in the chain's gas token (BNB) from the same wallet.
 *
 * Calls are sequential per wallet (approve is mined before the stake is built), so the "pending" nonce is enough; two
 * callers signing for the same wallet at once would collide on the nonce and one would fail.
 * Node only. Imported with relative paths by the Convex actions.
 */
import { formatEther, type Address, type Hex } from "viem";

import type { ArcCall } from "../arc/session";
import { actionCalls, actionContract, type MarketAction } from "../chains/calls";
import { chainPublicClient, usdcAllowanceWei } from "../chains/client";
import type { MarketChain } from "../chains/registry";
import { signTransaction } from "./circle-w3s";

/** Head room over the node's gas estimate, in percent. */
const GAS_HEADROOM_PCT = 120n;
const RECEIPT_TIMEOUT_MS = 90_000;

export interface UnsignedTx {
  chainId: number;
  nonce: number;
  to: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
  /** Legacy-style price used for both EIP-1559 caps: the effective price is exactly this. */
  gasPrice: bigint;
}

/** The Ethereum JSON-RPC shaped object Circle signs, quantities as decimal strings (as Circle's docs show). */
export function circleTxObject(t: UnsignedTx): Record<string, string | number> {
  return {
    chainId: t.chainId,
    nonce: String(t.nonce),
    to: t.to,
    data: t.data,
    value: t.value.toString(),
    gas: t.gas.toString(),
    maxFeePerGas: t.gasPrice.toString(),
    maxPriorityFeePerGas: t.gasPrice.toString(),
  };
}

/** Circle's signedTransaction as 0x hex for eth_sendRawTransaction; throws on anything that is not hex. */
export function signedTxHex(raw: string): Hex {
  const s = raw.trim();
  const hex = /^0x/i.test(s) ? s.slice(2) : s;
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error("Circle returned a signed transaction that is not hex");
  return `0x${hex}`;
}

/** Gas limit with head room, and the most the tx can cost the wallet in the gas token (wei). */
export function gasBudget(estimate: bigint, gasPrice: bigint, value = 0n): { gas: bigint; maxCostWei: bigint } {
  const gas = (estimate * GAS_HEADROOM_PCT) / 100n;
  return { gas, maxCostWei: gas * gasPrice + value };
}

/** One call from a signing-only Circle wallet: build, sign at Circle, broadcast, wait. Returns the mined tx hash. */
export async function circleSignAndSend(chain: MarketChain, w: { walletId: string; address: string }, call: ArcCall): Promise<Hex> {
  const pub = chainPublicClient(chain);
  const from = w.address as Address;
  const value = call.value ?? 0n;
  const [nonce, gasPrice, estimate, balance] = await Promise.all([
    pub.getTransactionCount({ address: from, blockTag: "pending" }),
    pub.getGasPrice(),
    pub.estimateGas({ account: from, to: call.to, data: call.data, value }),
    pub.getBalance({ address: from }),
  ]);
  const { gas, maxCostWei } = gasBudget(estimate, gasPrice, value);
  if (balance < maxCostWei) {
    throw new Error(`${from} has ${formatEther(balance)} ${chain.gas.symbol} on ${chain.label}, needs ~${formatEther(maxCostWei)} for gas`);
  }
  const signed = await signTransaction(w.walletId, circleTxObject({ chainId: chain.chainId, nonce, to: call.to, data: call.data, value, gas, gasPrice }));
  const hash = await pub.sendRawTransaction({ serializedTransaction: signedTxHex(signed) });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  if (rc.status !== "success") throw new Error(`tx reverted on ${chain.label}: ${hash}`);
  return hash;
}

/**
 * Stake `wei` (gross, index units) from a signing-only Circle wallet: approve exactly `wei` when the allowance falls
 * short, then the VS challenge (side B) or the pool stake. Same calls as circleStake on Base. Returns the stake's hash.
 */
export async function circleSignedStake(
  chain: MarketChain,
  w: { walletId: string; address: string },
  a: { kind: "vs" | "pool"; marketId: number; side: 1 | 2; wei: bigint; referrer?: Address },
): Promise<Hex> {
  const action: MarketAction = { type: "stake", kind: a.kind, marketId: a.marketId, stake: a.wei, side: a.side, referrer: a.referrer };
  const allowance = await usdcAllowanceWei(chain, w.address as Address, actionContract(chain, action));
  let hash: Hex | null = null;
  for (const call of actionCalls(chain, action, allowance)) hash = await circleSignAndSend(chain, w, call);
  if (!hash) throw new Error("no call to send");
  return hash;
}
