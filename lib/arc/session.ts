/**
 * The user's market session: the connected EVM wallet (an EOA) IS the account. Every market call (create, stake,
 * dispute, claim, cancel) is a plain transaction from that wallet: `eth_sendTransaction` with the call's native value,
 * after switching the wallet to the session's chain, then a wait for the receipt. On Arc the value and the gas are both
 * native USDC (18 dp), so nothing needs an approval.
 *
 * The session keeps its chain id so another chain (Base, a later phase) can plug in its own session without the forms
 * changing. Pure and isomorphic: the wallet and the chain reads come in as functions, so it is tested without either.
 */
import { numberToHex, type Address, type Hex } from "viem";

export interface ArcCall {
  to: Address;
  data: Hex;
  /** Native value in wei (on Arc: USDC, 18 dp). */
  value?: bigint;
}

export interface CallsReceipt {
  /** The last transaction's hash (the one a form links to). */
  txHash: Hex;
  /** Every transaction sent, in order. */
  txHashes: Hex[];
}

export interface ArcSession {
  /** The chain every call is sent on. */
  chainId: number;
  /** The connected wallet: the user's identity and market account. */
  address: Address;
  /** Sends each call as its own transaction, in order, waiting for each receipt; throws on the first revert. */
  sendCalls(calls: ArcCall[]): Promise<CallsReceipt>;
  /** EIP-191 personal_sign with the wallet. */
  signMessage(message: string): Promise<Hex>;
}

/** The transaction `eth_sendTransaction` takes for a call: hex quantities, no gas fields (the wallet estimates). */
export function callToTx(from: Address, call: ArcCall): { from: Address; to: Address; data: Hex; value: Hex } {
  return { from, to: call.to, data: call.data, value: numberToHex(call.value ?? 0n) };
}

export interface EoaDeps {
  chainId: number;
  address: Address;
  /** Put the wallet on `chainId` (called right before each send). */
  switchChain(chainId: number): Promise<void>;
  /** The wallet's eth_sendTransaction; resolves with the tx hash. */
  sendTransaction(tx: ReturnType<typeof callToTx>): Promise<Hex>;
  /** Waits for the receipt on `chainId`. */
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted" }>;
  signMessage(message: string): Promise<Hex>;
}

export class CallRevertedError extends Error {
  constructor(public readonly txHash: Hex) {
    super(`The transaction reverted (tx ${txHash}).`);
  }
}

/** A session backed by the connected wallet. */
export function eoaSession(d: EoaDeps): ArcSession {
  return {
    chainId: d.chainId,
    address: d.address,
    async sendCalls(calls) {
      if (!calls.length) throw new Error("no calls to send");
      const txHashes: Hex[] = [];
      for (const call of calls) {
        await d.switchChain(d.chainId);
        const hash = await d.sendTransaction(callToTx(d.address, call));
        txHashes.push(hash);
        const receipt = await d.waitForReceipt(hash);
        if (receipt.status !== "success") throw new CallRevertedError(hash);
      }
      return { txHash: txHashes[txHashes.length - 1], txHashes };
    },
    signMessage: (message) => d.signMessage(message),
  };
}
