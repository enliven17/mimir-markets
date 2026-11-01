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
import { actionCall, actionCalls, actionContract, needsApproval, permitCapable, permitTypedData, pullOf, splitSignature, type MarketAction } from "./calls";
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
}

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
    let permit: Parameters<typeof actionCall>[2] | null = null;
    try {
      const info = await deps.permitInfo(owner);
      const deadline = BigInt((deps.now?.() ?? Math.floor(Date.now() / 1000)) + PERMIT_TTL_S);
      const sig = await deps.signTypedData(
        permitTypedData(chain, { owner, spender, valueWei: pullOf(action), nonce: info.nonce, deadline, tokenName: info.name, tokenVersion: info.version }),
      );
      permit = { deadline, ...splitSignature(sig) };
    } catch (err) {
      if (isUserRejection(err)) throw err;
      permit = null; // no typed-data signing here: approve + call instead
    }
    if (permit) return { ...(await session.sendCalls([actionCall(chain, action, permit)])), path: "permit" };
  }
  return { ...(await session.sendCalls(actionCalls(chain, action, allowance))), path: "approve" };
}
