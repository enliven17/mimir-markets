/**
 * Market calls from Circle developer-controlled wallets (Mimir's agents: council, house creator, launch agents, copy
 * wallets), on any market chain (lib/chains/registry.ts). Amounts in index units (18 dp, lib/chains/amounts.ts).
 *
 *   Arc   one contractExecution, the stake as its native `amount` (gas in USDC from the same wallet).
 *   Base  approve(exact) on USDC first when the allowance falls short, then the call with the amount as an argument.
 *         Circle wallets on Base pay gas in ETH: Mimir (or the owner) funds them with a little ETH; there is no gas
 *         station. The approve and the call are two transactions (Circle EOA wallets cannot batch).
 *
 * Node only (Circle's entity-secret encryption). Imported with relative paths by the Convex actions.
 */
import { parseEventLogs, type Address, type Hex } from "viem";

import { indexToDecimal6, toChainUnits } from "../chains/amounts";
import { ARC_POOL_ABI, ARC_V3_ABI } from "../chains/calls";
import { chainPublicClient, usdcAllowanceWei, usdcBalanceWei } from "../chains/client";
import { circleBlockchain } from "../chains/house";
import type { MarketChain } from "../chains/registry";
import { executeContract, transferNative } from "./circle-w3s";

const ZERO = "0x0000000000000000000000000000000000000000";
/** Circle takes decimal amounts with at most 6 decimals: an amount finer than that cannot be sent exactly. */
const MICRO = { usdc: { decimals: 6 as const } };

function contractOf(chain: MarketChain, kind: "vs" | "pool"): Address {
  const c = kind === "vs" ? chain.contracts.mimirV3 : chain.contracts.mimirPool;
  if (!c) throw new Error(`no ${kind} contract on ${chain.label}`);
  return c;
}

/** Base: approve `spender` for exactly `wei` when the wallet's allowance is short. Arc: nothing. Returns the approve tx, if any. */
export async function ensureCircleAllowance(chain: MarketChain, w: { walletId: string; address: string }, spender: Address, wei: bigint): Promise<Hex | null> {
  if (chain.usdc.kind !== "erc20" || wei === 0n) return null;
  const allowance = await usdcAllowanceWei(chain, w.address as Address, spender);
  if (allowance >= wei) return null;
  return executeContract({
    walletId: w.walletId,
    contractAddress: chain.usdc.address,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [spender, toChainUnits(chain, wei)],
  });
}

/** Stake `wei` (gross, index units) on a market: VS challenge (side B) or a pool side. Returns the stake's tx hash. */
export async function circleStake(
  chain: MarketChain,
  w: { walletId: string; address: string },
  a: { kind: "vs" | "pool"; marketId: number; side: 1 | 2 | number; wei: bigint; referrer?: Address },
): Promise<Hex> {
  const to = contractOf(chain, a.kind);
  const referrer = a.referrer ?? ZERO;
  toChainUnits(MICRO, a.wei); // whole micro-USDC or throws: never a silent rounding
  const units = toChainUnits(chain, a.wei);
  if (chain.usdc.kind === "native") {
    const amount = indexToDecimal6(a.wei);
    return a.kind === "vs"
      ? executeContract({ walletId: w.walletId, contractAddress: to, abiFunctionSignature: "challengeClaim(uint256,uint256,string,address)", abiParameters: [BigInt(a.marketId), units, "", referrer], amount })
      : executeContract({ walletId: w.walletId, contractAddress: to, abiFunctionSignature: "stake(uint256,uint8,address)", abiParameters: [BigInt(a.marketId), a.side, referrer], amount });
  }
  await ensureCircleAllowance(chain, w, to, a.wei);
  return a.kind === "vs"
    ? executeContract({ walletId: w.walletId, contractAddress: to, abiFunctionSignature: "challengeClaim(uint256,uint256,string,address)", abiParameters: [BigInt(a.marketId), units, "", referrer] })
    : executeContract({ walletId: w.walletId, contractAddress: to, abiFunctionSignature: "stake(uint256,uint8,address,uint256)", abiParameters: [BigInt(a.marketId), a.side, referrer, units] });
}

export interface PoolDraft {
  question: string;
  labelA: string;
  labelB: string;
  resolutionUrl: string;
  category: string;
  deadline: number;
  side: 1 | 2 | number;
}

/** Open a two-sided pool with a seed stake of `wei` (index units) on `side`. Returns the tx hash. */
export async function circleCreatePool(chain: MarketChain, w: { walletId: string; address: string }, d: PoolDraft, wei: bigint): Promise<Hex> {
  const to = contractOf(chain, "pool");
  toChainUnits(MICRO, wei);
  const head = [d.question, d.labelA, d.labelB, d.resolutionUrl, d.category, BigInt(d.deadline), d.side, ZERO];
  if (chain.usdc.kind === "native") {
    return executeContract({ walletId: w.walletId, contractAddress: to, abiFunctionSignature: "createMarket(string,string,string,string,string,uint256,uint8,address)", abiParameters: head, amount: indexToDecimal6(wei) });
  }
  await ensureCircleAllowance(chain, w, to, wei);
  return executeContract({
    walletId: w.walletId,
    contractAddress: to,
    abiFunctionSignature: "createMarket(string,string,string,string,string,uint256,uint8,address,uint256)",
    abiParameters: [...head, toChainUnits(chain, wei)],
  });
}

/** Cancel an unchallenged VS claim (the stake comes back). Same call on both chains. */
export const circleCancelVs = (chain: MarketChain, walletId: string, marketId: number) =>
  executeContract({ walletId, contractAddress: contractOf(chain, "vs"), abiFunctionSignature: "cancelClaim(uint256)", abiParameters: [BigInt(marketId)] });

/** The market id a create transaction opened (its ClaimCreated / MarketCreated log), or null. */
export async function createdMarketId(chain: MarketChain, kind: "vs" | "pool", tx: Hex): Promise<number | null> {
  const rc = await chainPublicClient(chain).waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
  const to = contractOf(chain, kind).toLowerCase();
  const logs = rc.logs.filter((l) => l.address.toLowerCase() === to);
  const parsed = kind === "vs" ? parseEventLogs({ abi: ARC_V3_ABI, logs, eventName: "ClaimCreated" }) : parseEventLogs({ abi: ARC_POOL_ABI, logs, eventName: "MarketCreated" });
  const id = parsed[0]?.args.id;
  return id === undefined ? null : Number(id);
}

/** USDC a wallet holds on the chain, index units. */
export const walletUsdcWei = (chain: MarketChain, address: string) => usdcBalanceWei(chain, address as Address);

/** The wallet's gas token (ETH on Base, USDC on Arc), wei. */
export const walletGasWei = (chain: MarketChain, address: string) => chainPublicClient(chain).getBalance({ address: address as Address });

/** Send USDC (index units, floored to the chain's 6-dp precision) from a Circle wallet to `to`. */
export function circleSendUsdc(chain: MarketChain, walletId: string, to: Address, wei: bigint): Promise<Hex> {
  const blockchain = circleBlockchain(chain.id, chain.network);
  return transferNative({ walletId, to, amount: indexToDecimal6(wei), blockchain, ...(chain.usdc.kind === "erc20" ? { tokenAddress: chain.usdc.address } : {}) });
}

/** Send the gas token (ETH on Base), in wei, from a Circle wallet to `to`. */
export function circleSendGas(chain: MarketChain, walletId: string, to: Address, wei: bigint): Promise<Hex> {
  const eth = (Number(wei) / 1e18).toFixed(18).replace(/\.?0+$/, "");
  return transferNative({ walletId, to, amount: eth, blockchain: circleBlockchain(chain.id, chain.network) });
}
