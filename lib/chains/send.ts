/**
 * Sending one market action from a wallet the user holds (lib/arc/session.ts eoaSession), on any market chain:
 *
 *   Arc   one transaction, the stake as msg.value.
 *   Base  the allowance already covers it → the call alone;
 *         else, a pool create/stake/dispute → sign an EIP-2612 permit in the wallet, then ONE transaction (...WithPermit);
 *         a wallet that cannot sign typed data (or a token that refuses) falls back to approve(exact) + call;
 *         VS (no permit variants) → approve(exact) + call.
 *   Gas on Base is ETH: with none, it stops before the wallet opens, with a plain message.
 *
 * Pure: the wallet and the chain reads come in as functions (tests/node/chain-send.test.ts).
 */
import type { Address, Hex } from "viem";

import type { ArcSession, CallsReceipt } from "../arc/session";
import { actionCall, actionCalls, actionContract, needsApproval, permitCapable, permitTypedData, pullOf, splitSignature, type MarketAction, type PermitSig } from "./calls";
import type { MarketChain } from "./registry";

export interface MarketSendDeps {
  /** USDC allowance owner → spender, index units. */
  allowance(owner: Address, spender: Address): Promise<bigint>;
  /** The gas token balance (ETH on Base), wei; null when unknown (no check then). */
  gasBalance?(owner: Address): Promise<bigint | null>;
  /** The USDC permit inputs: nonce, EIP-712 name and version. */
  permitInfo?(owner: Address): Promise<{ nonce: bigint; name: string; version: string }>;
  /** eth_signTypedData_v4 with the wallet; absent = permits are never tried. */
  signTypedData?(typed: ReturnType<typeof permitTypedData>): Promise<Hex>;
  /** Unix seconds (permit deadline). */
  now?(): number;
  /** eth_call of the permit transaction from the owner; throws when it would revert. Absent = no pre-check. */
  simulate?(call: { from: Address; to: Address; data: Hex }): Promise<void>;
  /** Waits between pre-check attempts (tests pass a no-op). */
  sleep?(ms: number): Promise<void>;
}

/**
 * Permit nonces this page already consumed, per chain and owner. Right after a permit transaction a load-balanced RPC
 * can still return the old nonce; signing with it makes a second wallet request that is bound to fail.
 */
const usedPermitNonce = new Map<string, bigint>();

export type SendPath = "native" | "allowance" | "permit" | "approve";

export class NoGasError extends Error {
  constructor(chain: MarketChain) {
    super(`Your wallet has no ${chain.gas.symbol} on ${chain.name} for gas. Add a little ${chain.gas.symbol} on ${chain.label}, then try again.`);
  }
}

/** A wallet refusal (the user said no) is never a reason to fall back to another path. */
export const isUserRejection = (err: unknown) => {
  const e = err as { code?: number; message?: string };
  return e?.code === 4001 || /User rejected|rejected the request|denied/i.test(e?.message ?? "");
};

/** How long a permit signature stays valid. */
const PERMIT_TTL_S = 30 * 60;

export async function sendMarketAction(
  chain: MarketChain,
  session: Pick<ArcSession, "address" | "sendCalls">,
  action: MarketAction,
  deps: MarketSendDeps,
): Promise<CallsReceipt & { path: SendPath }> {
  if (chain.usdc.kind === "native") return { ...(await session.sendCalls([actionCall(chain, action)])), path: "native" };

  const owner = session.address;
  if (deps.gasBalance) {
    const gas = await deps.gasBalance(owner).catch(() => null);
    if (gas === 0n) throw new NoGasError(chain);
  }
  const spender = actionContract(chain, action);
  const allowance = pullOf(action) > 0n ? await deps.allowance(owner, spender) : 0n;
  if (!needsApproval(chain, action, allowance)) return { ...(await session.sendCalls([actionCall(chain, action)])), path: "allowance" };

  if (permitCapable(chain, action) && deps.signTypedData && deps.permitInfo) {
    let permit: (PermitSig & { nonce: bigint }) | null = null;
    try {
      const info = await deps.permitInfo(owner);
      const seen = usedPermitNonce.get(`${chain.chainId}:${owner.toLowerCase()}`);
      if (seen !== undefined && seen > info.nonce) info.nonce = seen;
      const deadline = BigInt((deps.now?.() ?? Math.floor(Date.now() / 1000)) + PERMIT_TTL_S);
      const sig = await deps.signTypedData(
        permitTypedData(chain, { owner, spender, valueWei: pullOf(action), nonce: info.nonce, deadline, tokenName: info.name, tokenVersion: info.version }),
      );
      permit = { deadline, ...splitSignature(sig), nonce: info.nonce };
    } catch (err) {
      if (isUserRejection(err)) throw err;
      permit = null; // no typed-data signing here: approve + call instead
    }
    if (permit) {
      const call = actionCall(chain, action, permit);
      // Never open the wallet on a transaction that would revert: a lagging RPC gets a few seconds to catch up.
      if (deps.simulate) {
        const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
        for (let attempt = 1; ; attempt++) {
          try { await deps.simulate({ from: owner, to: call.to, data: call.data }); break; }
          catch (err) { if (attempt >= 3) throw err; await sleep(1500); }
        }
      }
      const sent = await session.sendCalls([call]);
      usedPermitNonce.set(`${chain.chainId}:${owner.toLowerCase()}`, permit.nonce + 1n);
      return { ...sent, path: "permit" };
    }
  }
  return { ...(await session.sendCalls(actionCalls(chain, action, allowance))), path: "approve" };
}
