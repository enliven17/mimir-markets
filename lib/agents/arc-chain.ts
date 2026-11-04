import { normalizeOwner } from "../owner";
import { prepareNative } from "./native-chain";
import type { WriteParams } from "./params";
/**
 * The agent API on Mimir's market chains (Base, the default, and Arc). Writes come back as unsigned EVM transactions
 * for the agent's operator (an address it holds the key to; the same address on both chains) to sign and send itself:
 * the API never holds a key. Reads come from the Convex index (positions, markets) and the chain's RPC (balance).
 *
 *   createClaim  open a VS market (default) or a pool (kind: "pool", side)
 *   challenge    take side B of a VS market, or a side of a pool (kind: "pool", side)
 *   dispute      escalate a proposed result with the 2 USDC bond
 *   withdraw     pull a payout a contract parked for the operator (kind: "vs" default, or "pool")
 *
 * `chain` ("base" | "arc" | "solana") picks the network; it defaults to the deployment's default chain (Base when configured).
 * Arc: one transaction, the USDC as value (18-dp wei), gas in USDC. Base: the USDC is an ERC-20 (6 dp) pulled by the
 * contract, so an exact `approve` comes first whenever the operator's allowance is short; gas is ETH, so the operator
 * needs a little ETH on Base. Entry fees apply as for anyone (lib/arc/fees.ts).
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";

import { AgentEnvelopeError } from "./api";
import { readStakeLimits, stakeLimitBlocker, type ArcMarketKind } from "@/lib/arc/markets";
import { toIndexUnits } from "@/lib/chains/amounts";
import { actionCalls, actionContract, pullOf, type MarketAction } from "@/lib/chains/calls";
import { chainPublicClient, gasBalanceWei, usdcAllowanceWei, usdcBalanceWei } from "@/lib/chains/client";
import { isMarketChainId, MARKET_CHAINS, type MarketChain } from "@/lib/chains/registry";
import { arcMarketDetail, arcMarketList, arcPositions } from "@/lib/server/arc-index";

/** Agents can trade when at least one market chain is configured. */
export const arcAgentsEnabled = () => MARKET_CHAINS.enabled.length > 0;

export interface ArcTx {
  chainId: number;
  to: Address;
  data: Hex;
  /** Native value in wei, as a decimal string: the USDC on Arc (18 dp), always "0" on Base (USDC is an ERC-20). */
  value: string;
  description: string;
}

const units6ToWei = (units: bigint) => units * 1_000_000_000_000n;

/** The chain a request names (`chain`), else the default one; refused when it is not enabled here. */
export function chainOf(body: Record<string, unknown>): MarketChain {
  const raw = body.chain;
  if (raw !== undefined && !isMarketChainId(raw)) throw new AgentEnvelopeError('chain must be "base" or "arc"', 400, "bad_params");
  const c = MARKET_CHAINS.chains[raw ?? MARKET_CHAINS.defaultChain];
  if (!c.enabled) throw new AgentEnvelopeError(`${c.label} markets are not configured on this deployment`, 503, "chain_unavailable");
  return c;
}

function kindOf(body: Record<string, unknown>): ArcMarketKind {
  const k = body.kind ?? "vs";
  if (k !== "vs" && k !== "pool") throw new AgentEnvelopeError('kind must be "vs" or "pool"', 400, "bad_params");
  return k;
}

function sideOf(body: Record<string, unknown>, fallback: 1 | 2): 1 | 2 {
  const s = body.side ?? fallback;
  if (s !== 1 && s !== 2) throw new AgentEnvelopeError("side must be 1 (A) or 2 (B)", 400, "bad_params");
  return s;
}

export function arcOperatorOf(value: unknown): string | null { return normalizeOwner(value); }

/** The parsed write (lib/agents/params.ts) as the market action it is; `body` carries kind, side and chain. */
export function writeAction(write: { action: string; params: Record<string, unknown> }, body: Record<string, unknown>): MarketAction {
  const p = write.params;
  switch (write.action) {
    case "createClaim": {
      const kind = kindOf(body);
      return {
        type: "create",
        market: {
          kind,
          question: String(p.question),
          labelA: String(p.creatorPosition),
          labelB: String(p.counterPosition),
          resolutionUrl: String(p.resolutionUrl),
          category: String(p.category),
          deadline: Number(p.deadline),
          stake: units6ToWei(p.stakeUnits as bigint),
          side: kind === "pool" ? sideOf(body, 1) : undefined,
        },
      };
    }
    case "challenge": {
      const kind = kindOf(body);
      return { type: "stake", kind, marketId: Number(p.claimId), stake: units6ToWei(p.stakeUnits as bigint), side: kind === "vs" ? 2 : sideOf(body, 2) };
    }
    case "dispute":
      return { type: "dispute", kind: kindOf(body), marketId: Number(p.claimId as bigint | number) };
    case "withdraw":
      return { type: "withdraw", kind: kindOf(body) };
    default:
      throw new AgentEnvelopeError(`${write.action} is not needed: stakes are paid straight from the operator`, 410, "not_on_arc");
  }
}

function describe(a: MarketAction, chain: MarketChain, approve: boolean, i: number): string {
  if (approve && i === 0) return `approve ${chain.label} USDC for exactly this ${a.type === "dispute" ? "bond" : "stake"}`;
  const kind = a.type === "create" ? a.market.kind : a.type === "stake" || a.type === "dispute" || a.type === "withdraw" ? a.kind : "vs";
  switch (a.type) {
    case "create":
      return `open a ${kind === "vs" ? "VS" : "pool"} market on ${chain.label} staking ${Number(a.market.stake / 1_000_000_000_000n)} units (entry fee comes off it)`;
    case "stake":
      return `${kind === "vs" ? "challenge VS" : "stake on pool"} #${a.marketId} on ${chain.label}`;
    case "dispute":
      return `dispute ${kind} #${a.marketId} on ${chain.label} with the 2 USDC bond`;
    default:
      return `pull a parked payout on ${chain.label}`;
  }
}

/**
 * The write as unsigned transactions on its chain, in order. `allowanceWei` is the operator's current USDC allowance
 * to the market contract (index units; Base only): an approve is included unless it covers the pull. Unknown = 0.
 */
export function prepareArcWrite(
  write: { action: string; params: Record<string, unknown> },
  body: Record<string, unknown>,
  allowanceWei = 0n,
): { chain: MarketChain["id"]; transactions: ArcTx[] } {
  const chain = chainOf(body);
  const action = writeAction(write, body);
  const calls = actionCalls(chain, action, allowanceWei);
  const approve = calls.length > 1;
  return {
    chain: chain.id,
    transactions: calls.map((c, i) => ({ chainId: chain.chainId, to: c.to, data: c.data, value: (c.value ?? 0n).toString(), description: describe(action, chain, approve, i) })),
  };
}

/** prepareArcWrite with the operator's live allowance read first (Base), so an approve is only sent when needed. */
export async function prepareChainWrite(write: { action: string; params: Record<string, unknown> }, body: Record<string, unknown>, operator: string) {
  return prepareNative(write as unknown as WriteParams, body, operator);
}

/** The operator's USDC on the chain (index units, 18 dp) and, on Base, its ETH for gas (wei). */
export async function arcOperatorBalance(operator: string, body: Record<string, unknown> = {}): Promise<{ chain: string; usdcWei: string; gasWei?: string }> {
  const chain = chainOf(body);
  const [usdc, gas] = await Promise.all([usdcBalanceWei(chain, operator), chain.gas.symbol !== "USDC" ? gasBalanceWei(chain, operator) : Promise.resolve(null)]);
  return { chain: chain.id, usdcWei: usdc.toString(), ...(gas !== null ? { gasWei: gas.toString() } : {}) };
}

/**
 * The contract's live limits for an agent stake (pause, early lock, launch caps), checked before a transaction is
 * prepared, so an agent gets the same plain reason the site shows instead of a bare revert. Throws a 409
 * AgentEnvelopeError("stake_limit"). Agents pay the standard entry fee (no holder ticket), so 50 bps is assumed.
 */
export async function assertArcStakeAllowed(_write: { action: string; params: Record<string, unknown> }, body: Record<string, unknown>, _operator: string): Promise<void> {
  if (body.chain !== undefined && body.chain !== "solana") throw new AgentEnvelopeError("Solana devnet only", 400, "bad_chain");
  if (body.kind !== undefined && body.kind !== "vs") throw new AgentEnvelopeError("Public VS markets only", 400, "bad_kind");
}

export async function arcOperatorPositions(operator: string, body: Record<string, unknown> = {}) {
  const rows = (await arcPositions(operator)) as Array<{ chain?: string }>;
  const want = body.chain;
  return want === undefined ? rows : rows.filter((p) => (p.chain ?? "arc") === want);
}

// MimirV3 numbering: 0 open … 5 disputed.
const STATUS_OF = ["open", "active", "resolved", "cancelled", "proposed", "disputed"] as const;

/** Public markets from the index (every chain, or `chain`), filtered by state numbers and category, newest first. */
export async function arcMarkets(f: { states?: number[]; category?: string; limit: number; kind?: unknown; chain?: unknown }) {
  const wanted = f.states ? new Set(f.states.map((s) => STATUS_OF[s])) : null;
  const kind = f.kind === "vs" || f.kind === "pool" ? f.kind : undefined;
  const chain = isMarketChainId(f.chain) ? f.chain : undefined;
  return (await arcMarketList(kind, chain)).filter((m) => (!wanted || wanted.has(m.status)) && (!f.category || m.category === f.category)).slice(0, f.limit);
}

export async function arcMarket(kind: ArcMarketKind, marketId: number, body: Record<string, unknown> = {}) {
  return arcMarketDetail(kind, marketId, chainOf(body).id);
}
