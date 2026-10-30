/**
 * A Base agent's wallet at work: launch its token on Clanker v4, claim its creator fees, send ETH home. Each
 * transaction: nonce (pending), gas estimate +20%, EIP-1559 fees from the node, signed by Privy (eth_signTransaction,
 * under the wallet's policy: lib/launch/base/policy.ts), broadcast here, and awaited; a revert throws.
 *
 * Builder code (BASE_BUILDER_CODE, lib/base/builder-code.ts): appended to the launch and fee-claim calldata, the
 * agent's own Base activity. Not to the WETH unwrap (its policy rule decodes calldata) nor to plain ETH sends.
 *
 * Units: ETH amounts cross the shared launch code in gwei (as on Robinhood Chain), wei inside.
 * TODO(base-trading): no buy/sell yet. Base agents launch, earn and claim fees, and stake on Arc; trading Clanker
 * tokens (Uniswap v4 via the UniversalRouter, as lib/launch/robinhood/v4.ts does for Pons pools) is the next step.
 */
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseEventLogs,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import { BASE_CHAIN } from "../../base/chain";
import { withBuilderSuffix } from "../../base/builder-code";
import type { EvmTx, Privy } from "../solana/privy";
import { BASE_WETH, CLANKER_FEE_LOCKER, FEE_LOCKER_ABI, WETH_ABI } from "./clanker";

/** Kept in the wallet for gas: Base gas is cheap, this covers hundreds of claims. */
export const BASE_RESERVE_WEI = 200_000_000_000_000n; // 0.0002 ETH
const GWEI = 1_000_000_000n;

/** A deploy transaction as clanker-sdk builds it (`Clanker.getDeployTransaction`). */
export type DeployTx = { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; value?: bigint; expectedAddress?: Address };

export type BaseExecutorDeps = {
  privy: Pick<Privy, "signEvmTransaction">;
  client?: PublicClient;
  rpcUrl?: string;
  reserveWei?: bigint;
  builderSuffix?: Hex | null;
};

export function createBaseExecutor(d: BaseExecutorDeps) {
  const client = d.client ?? (createPublicClient({ transport: http(d.rpcUrl ?? BASE_CHAIN.rpcUrl, { timeout: 20_000, retryCount: 2 }) }) as PublicClient);
  const reserve = d.reserveWei ?? BASE_RESERVE_WEI;
  const suffix = d.builderSuffix ?? null;
  const addr = (a: string) => a as Address;

  async function send(walletId: string, wallet: string, call: { to: Address; data: Hex; value?: bigint }, onSigned?: (hash: string) => Promise<void>): Promise<TransactionReceipt> {
    const from = addr(wallet);
    const value = call.value ?? 0n;
    const [nonce, gas, fees] = await Promise.all([
      client.getTransactionCount({ address: from, blockTag: "pending" }),
      client.estimateGas({ account: from, to: call.to, data: call.data, value }),
      client.estimateFeesPerGas(),
    ]);
    const tx: EvmTx = {
      to: call.to, value: toHex(value), data: call.data, chain_id: BASE_CHAIN.id, nonce,
      gas_limit: toHex((gas * 12n) / 10n), max_fee_per_gas: toHex(fees.maxFeePerGas), max_priority_fee_per_gas: toHex(fees.maxPriorityFeePerGas), type: 2,
    };
    const signed = await d.privy.signEvmTransaction(walletId, tx);
    const hash = await client.sendRawTransaction({ serializedTransaction: signed });
    await onSigned?.(hash);
    let receipt: TransactionReceipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
    } catch (err) {
      // Broadcast but not seen confirmed: it may still land, so callers must not treat this as "did not happen".
      const e = new Error(`transaction ${hash} was sent but not confirmed: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
      e.name = "AmbiguousSendError";
      throw e;
    }
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return receipt;
  }

  return {
    /** Spendable ETH in gwei, after the gas reserve. */
    async spendable(wallet: string): Promise<bigint> {
      const balance = await client.getBalance({ address: addr(wallet) });
      return balance > reserve ? (balance - reserve) / GWEI : 0n;
    },

    /** Sends ETH (gwei) out; the wallet's policy only allows the owner's payout address and the treasury. */
    async transferEth(a: { walletId: string; wallet: string; to: string; gwei: bigint }): Promise<string> {
      return (await send(a.walletId, a.wallet, { to: addr(a.to), value: a.gwei * GWEI, data: "0x" })).transactionHash;
    },

    /** WETH creator fees waiting in the ClankerFeeLocker for this wallet, in wei. */
    accrued: (wallet: string) => client.readContract({ address: CLANKER_FEE_LOCKER, abi: FEE_LOCKER_ABI, functionName: "availableFees", args: [addr(wallet), BASE_WETH] }),

    /**
     * Claim its creator fees (WETH) from the fee locker into the wallet, then unwrap all of its WETH to ETH. Null when
     * nothing was owed (no transaction sent).
     */
    async claimCreatorFees(a: { walletId: string; wallet: string }): Promise<{ sig: string; wei: bigint } | null> {
      const owed = await client.readContract({ address: CLANKER_FEE_LOCKER, abi: FEE_LOCKER_ABI, functionName: "availableFees", args: [addr(a.wallet), BASE_WETH] });
      if (owed === 0n) return null;
      const data = withBuilderSuffix(encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: "claim", args: [addr(a.wallet), BASE_WETH] }), suffix);
      const receipt = await send(a.walletId, a.wallet, { to: CLANKER_FEE_LOCKER, data });
      const weth = await client.readContract({ address: BASE_WETH, abi: WETH_ABI, functionName: "balanceOf", args: [addr(a.wallet)] });
      if (weth > 0n) await send(a.walletId, a.wallet, { to: BASE_WETH, data: encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [weth] }) });
      return { sig: receipt.transactionHash, wei: owed };
    },

    /**
     * Deploy the agent's token from its wallet. Idempotent by address: Clanker deploys by CREATE2 from the config, so a
     * launch that already landed (a retry after a timeout) is found at its expected address and never sent twice.
     */
    async launchToken(a: { walletId: string; wallet: string; deploy: DeployTx }): Promise<{ token: string; sig: string }> {
      const expected = a.deploy.expectedAddress;
      if (expected) {
        const code = await client.getCode({ address: expected });
        if (code && code !== "0x") return { token: getAddress(expected), sig: "" };
      }
      const data = withBuilderSuffix(encodeFunctionData({ abi: a.deploy.abi, functionName: a.deploy.functionName, args: a.deploy.args }), suffix);
      const receipt = await send(a.walletId, a.wallet, { to: a.deploy.address, data, value: a.deploy.value ?? 0n });
      const created = parseEventLogs({ abi: a.deploy.abi, logs: receipt.logs, eventName: "TokenCreated" }) as Array<{ address: Address; args: { tokenAddress?: Address } }>;
      const token = created.find((l) => l.address.toLowerCase() === a.deploy.address.toLowerCase())?.args.tokenAddress ?? expected;
      if (!token) throw new Error(`launch ${receipt.transactionHash} emitted no TokenCreated`);
      return { token: getAddress(token), sig: receipt.transactionHash };
    },
  };
}

export type BaseExecutor = ReturnType<typeof createBaseExecutor>;
