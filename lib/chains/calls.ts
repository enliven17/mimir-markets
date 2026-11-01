/**
 * Market transactions for any market chain: what a wallet (the user's, an agent operator's) sends to create, stake,
 * dispute, cancel, claim or withdraw. Pure and isomorphic. Amounts come in index units (18 dp, lib/chains/amounts.ts)
 * and go out in the chain's units, exactly (a sub-unit amount throws).
 *
 *   Arc   native USDC: the stake or bond is the call's msg.value; nothing to approve.
 *   Base  ERC-20 USDC: the contract pulls `pull` with transferFrom. The pool takes an EIP-2612 permit inside the call
 *         (createMarketWithPermit, stakeWithPermit, disputeWithPermit); MimirV3Erc20 has no permit variants (EIP-170),
 *         so VS needs an approve first. An approve is skipped when the allowance already covers the pull.
 */
import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";

import { ERC20_ABI } from "./client";
import { toChainUnits } from "./amounts";
import type { MarketChain } from "./registry";
import type { ArcCall } from "../arc/session";

export type MarketKind = "vs" | "pool";

/** Both chains: the dispute bond, 2 USDC (Arc 2e18 native, Base 2e6), here in index units. */
export const DISPUTE_BOND_WEI = 2_000_000_000_000_000_000n;

// Arc (native USDC): payable, the amount is msg.value.
export const ARC_V3_ABI = parseAbi([
  "function createClaim(string question, string creatorPosition, string counterPosition, string resolutionUrl, uint256 deadline, uint256 stakeAmount, string category, uint256 parentId, string marketType, string oddsMode, uint256 challengerPayoutBps, string handicapLine, string settlementRule, uint256 maxChallengers, bool isPrivate, string inviteKey, address referrer) payable returns (uint256)",
  "function challengeClaim(uint256 claimId, uint256 stakeAmount, string inviteKey, address referrer) payable",
  "function cancelClaim(uint256 claimId)",
  "function disputeResolution(uint256 claimId) payable",
  "function withdraw()",
  "event ClaimCreated(uint256 indexed id, address indexed creator, string category)",
]);
export const ARC_POOL_ABI = parseAbi([
  "function createMarket(string question, string labelA, string labelB, string resolutionUrl, string category, uint256 deadline, uint8 side, address referrer) payable returns (uint256)",
  "function stake(uint256 id, uint8 side, address referrer) payable",
  "function dispute(uint256 id) payable",
  "function claim(uint256 id)",
  "function withdraw()",
  "event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category)",
]);

// Base (contracts/MimirV3Erc20.sol, MimirPoolErc20.sol): nothing payable; V3 keeps its signatures, the pool takes `amount`.
export const ERC20_V3_ABI = parseAbi([
  "function createClaim(string question, string creatorPosition, string counterPosition, string resolutionUrl, uint256 deadline, uint256 stakeAmount, string category, uint256 parentId, string marketType, string oddsMode, uint256 challengerPayoutBps, string handicapLine, string settlementRule, uint256 maxChallengers, bool isPrivate, string inviteKey, address referrer) returns (uint256)",
  "function challengeClaim(uint256 claimId, uint256 stakeAmount, string inviteKey, address referrer)",
  "function cancelClaim(uint256 claimId)",
  "function disputeResolution(uint256 claimId)",
  "function withdraw()",
  "event ClaimCreated(uint256 indexed id, address indexed creator, string category)",
]);
export const ERC20_POOL_ABI = parseAbi([
  "function createMarket(string question, string labelA, string labelB, string resolutionUrl, string category, uint256 deadline, uint8 side, address referrer, uint256 amount) returns (uint256)",
  "function createMarketWithPermit(string question, string labelA, string labelB, string resolutionUrl, string category, uint256 deadline, uint8 side, address referrer, uint256 amount, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
  "function stake(uint256 id, uint8 side, address referrer, uint256 amount)",
  "function stakeWithPermit(uint256 id, uint8 side, address referrer, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function dispute(uint256 id)",
  "function disputeWithPermit(uint256 id, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function claim(uint256 id)",
  "function withdraw()",
  "event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category)",
]);

export interface NewMarketInput {
  kind: MarketKind;
  question: string;
  labelA: string;
  labelB: string;
  resolutionUrl: string;
  category: string;
  /** Unix seconds. */
  deadline: number;
  /** Gross, index units: what leaves the account; the entry fee comes off it. */
  stake: bigint;
  /** Pool only: the side the opening stake backs (1 = A, 2 = B). */
  side?: 1 | 2;
  referrer?: Address;
}

export type MarketAction =
  | { type: "create"; market: NewMarketInput }
  /** VS: challenge (side B). Pool: stake on `side`. `stake` gross, index units. */
  | { type: "stake"; kind: MarketKind; marketId: number; stake: bigint; side: 1 | 2; referrer?: Address }
  | { type: "dispute"; kind: MarketKind; marketId: number }
  | { type: "cancel"; marketId: number }
  | { type: "claim"; marketId: number }
  | { type: "withdraw"; kind: MarketKind };

/** A signed EIP-2612 permit for the pull (Base pool calls only). */
export interface PermitSig {
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

export const kindOfAction = (a: MarketAction): MarketKind =>
  a.type === "create" ? a.market.kind : a.type === "cancel" ? "vs" : a.type === "claim" ? "pool" : a.kind;

/** The contract an action goes to; throws when the chain lacks it. */
export function actionContract(chain: MarketChain, a: MarketAction): Address {
  const kind = kindOfAction(a);
  const c = kind === "vs" ? chain.contracts.mimirV3 : chain.contracts.mimirPool;
  if (!c) throw new Error(`Mimir's ${kind === "vs" ? "VS" : "pool"} contract is not configured on ${chain.label}`);
  return c;
}

/** What the action pulls from the sender (stake or bond), index units; 0 when nothing. */
export function pullOf(a: MarketAction): bigint {
  if (a.type === "create") return a.market.stake;
  if (a.type === "stake") return a.stake;
  if (a.type === "dispute") return DISPUTE_BOND_WEI;
  return 0n;
}

/** Only the pool's create, stake and dispute take a permit (MimirPoolErc20). */
export const permitCapable = (chain: MarketChain, a: MarketAction): boolean =>
  chain.usdc.kind === "erc20" && chain.usdc.permit && kindOfAction(a) === "pool" && (a.type === "create" || a.type === "stake" || a.type === "dispute");

/** The action itself as one call (no approve). With `permit` on a permit-capable Base action: the ...WithPermit variant. */
export function actionCall(chain: MarketChain, a: MarketAction, permit?: PermitSig): ArcCall {
  const to = actionContract(chain, a);
  const pull = pullOf(a);
  const amount = toChainUnits(chain, pull);
  const erc20 = chain.usdc.kind === "erc20";
  const value = erc20 ? undefined : pull || undefined;
  if (permit && !permitCapable(chain, a)) throw new Error("this call takes no permit");
  const id = (n: number) => BigInt(n);
  let data: Hex;
  switch (a.type) {
    case "create": {
      const m = a.market;
      const referrer = m.referrer ?? zeroAddress;
      if (m.kind === "vs") {
        const args = [m.question, m.labelA, m.labelB, m.resolutionUrl, BigInt(m.deadline), amount, m.category, 0n, "binary", "pool", 0n, "", "", 0n, false, "", referrer] as const;
        data = erc20
          ? encodeFunctionData({ abi: ERC20_V3_ABI, functionName: "createClaim", args })
          : encodeFunctionData({ abi: ARC_V3_ABI, functionName: "createClaim", args });
      } else {
        const head = [m.question, m.labelA, m.labelB, m.resolutionUrl, m.category, BigInt(m.deadline), m.side ?? 1, referrer] as const;
        data = !erc20
          ? encodeFunctionData({ abi: ARC_POOL_ABI, functionName: "createMarket", args: head })
          : permit
            ? encodeFunctionData({ abi: ERC20_POOL_ABI, functionName: "createMarketWithPermit", args: [...head, amount, permit.deadline, permit.v, permit.r, permit.s] })
            : encodeFunctionData({ abi: ERC20_POOL_ABI, functionName: "createMarket", args: [...head, amount] });
      }
      break;
    }
    case "stake": {
      const referrer = a.referrer ?? zeroAddress;
      if (a.kind === "vs") {
        const args = [id(a.marketId), amount, "", referrer] as const;
        data = erc20
          ? encodeFunctionData({ abi: ERC20_V3_ABI, functionName: "challengeClaim", args })
          : encodeFunctionData({ abi: ARC_V3_ABI, functionName: "challengeClaim", args });
      } else {
        data = !erc20
          ? encodeFunctionData({ abi: ARC_POOL_ABI, functionName: "stake", args: [id(a.marketId), a.side, referrer] })
          : permit
            ? encodeFunctionData({ abi: ERC20_POOL_ABI, functionName: "stakeWithPermit", args: [id(a.marketId), a.side, referrer, amount, permit.deadline, permit.v, permit.r, permit.s] })
            : encodeFunctionData({ abi: ERC20_POOL_ABI, functionName: "stake", args: [id(a.marketId), a.side, referrer, amount] });
      }
      break;
    }
    case "dispute":
      data =
        a.kind === "vs"
          ? encodeFunctionData({ abi: ARC_V3_ABI, functionName: "disputeResolution", args: [id(a.marketId)] })
          : permit
            ? encodeFunctionData({ abi: ERC20_POOL_ABI, functionName: "disputeWithPermit", args: [id(a.marketId), permit.deadline, permit.v, permit.r, permit.s] })
            : encodeFunctionData({ abi: ARC_POOL_ABI, functionName: "dispute", args: [id(a.marketId)] });
      break;
    case "cancel":
      data = encodeFunctionData({ abi: ARC_V3_ABI, functionName: "cancelClaim", args: [id(a.marketId)] });
      break;
    case "claim":
      data = encodeFunctionData({ abi: ARC_POOL_ABI, functionName: "claim", args: [id(a.marketId)] });
      break;
    case "withdraw":
      data = encodeFunctionData({ abi: ARC_V3_ABI, functionName: "withdraw" });
      break;
  }
  return value ? { to, data, value } : { to, data };
}

/** An ERC-20 approve of exactly `wei` (index units) of the chain's USDC to `spender`. */
export function approveCall(chain: MarketChain, spender: Address, wei: bigint): ArcCall {
  if (chain.usdc.kind !== "erc20") throw new Error(`${chain.label} USDC is native: nothing to approve`);
  return { to: chain.usdc.address, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, toChainUnits(chain, wei)] }) };
}

/** True when the action pulls more USDC than the allowance covers (always false on Arc). */
export const needsApproval = (chain: MarketChain, a: MarketAction, allowanceWei: bigint): boolean =>
  chain.usdc.kind === "erc20" && pullOf(a) > 0n && allowanceWei < pullOf(a);

/**
 * The plain path, no signature: [approve exact pull, action] when the allowance falls short, else [action]. This is
 * what agents (lib/agents/arc-chain.ts) and the browser's fallback send.
 */
export function actionCalls(chain: MarketChain, a: MarketAction, allowanceWei: bigint): ArcCall[] {
  const call = actionCall(chain, a);
  return needsApproval(chain, a, allowanceWei) ? [approveCall(chain, call.to, pullOf(a)), call] : [call];
}

/** The EIP-712 typed data of a USDC permit (FiatToken v2: name "USD Coin" on mainnet, "USDC" on Sepolia; version "2"). */
export function permitTypedData(
  chain: MarketChain,
  p: { owner: Address; spender: Address; valueWei: bigint; nonce: bigint; deadline: bigint; tokenName: string; tokenVersion: string },
) {
  return {
    domain: { name: p.tokenName, version: p.tokenVersion, chainId: chain.chainId, verifyingContract: chain.usdc.address },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit" as const,
    message: { owner: p.owner, spender: p.spender, value: toChainUnits(chain, p.valueWei), nonce: p.nonce, deadline: p.deadline },
  };
}

/** A 65-byte signature (0x r s v) as the permit's v, r, s. */
export function splitSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const hex = sig.slice(2);
  if (hex.length !== 130) throw new Error("not a 65-byte signature");
  let v = parseInt(hex.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { r: `0x${hex.slice(0, 64)}`, s: `0x${hex.slice(64, 128)}`, v };
}
