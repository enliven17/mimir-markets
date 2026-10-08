/**
 * The agent API on Arc. Writes come back as unsigned EVM transactions for the
 * agent's Arc operator (an address it holds the key to, funded with USDC on
 * Arc) to sign and send itself: the API never holds a key. Reads come from the
 * Convex index (positions, markets) and the Arc RPC (balance).
 *
 *   createClaim  open a VS market (default) or a pool (kind: "pool", side)
 *   challenge    take side B of a VS market, or a side of a pool (kind: "pool", side)
 *   dispute      escalate a proposed result with the 2 USDC bond
 *   withdraw     pull a payout MimirV3 parked for the operator
 * Entry fees apply as for anyone (lib/arc/fee-tiers.ts).
 */
import { encodeFunctionData, getAddress, isAddress, parseAbi, parseEther, type Address, type Hex } from "viem";

import { AgentEnvelopeError } from "./api";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { createMarketCall, MIMIR_POOL_ABI, MIMIR_V3_ABI, readStakeLimits, stakeCall, stakeLimitBlocker, type ArcMarketKind } from "@/lib/arc/markets";
import { arcMarketDetail, arcMarketList, arcPositions } from "@/lib/server/arc-index";

export const arcAgentsEnabled = () => Boolean(ARC.contracts.mimirV3 && ARC.contracts.mimirPool);

export interface ArcTx {
  chainId: number;
  to: Address;
  data: Hex;
  /** Native USDC in wei (18 dp), as a decimal string. */
  value: string;
  description: string;
}

const units6ToWei = (units: bigint) => units * 1_000_000_000_000n;
const BOND = parseEther("2");

function contracts() {
  const { mimirV3, mimirPool } = ARC.contracts;
  if (!mimirV3 || !mimirPool) throw new AgentEnvelopeError("Arc contracts are not configured", 503, "chain_unavailable");
  return { mimirV3, mimirPool };
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

const tx = (to: Address, data: Hex, value: bigint, description: string): ArcTx => ({ chainId: ARC.chain.id, to, data, value: value.toString(), description });

export function arcOperatorOf(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value.trim()) ? getAddress(value.trim()) : null;
}

/** The parsed write (lib/agents/params.ts) as Arc transactions; `body` carries the Arc-only knobs (kind, side). */
export function prepareArcWrite(
  write: { action: string; params: Record<string, unknown> },
  body: Record<string, unknown>,
): { transactions: ArcTx[] } {
  const { mimirV3, mimirPool } = contracts();
  const p = write.params;
  switch (write.action) {
    case "createClaim": {
      const kind = kindOf(body);
      const stake = units6ToWei(p.stakeUnits as bigint);
      const call = createMarketCall(kind === "vs" ? mimirV3 : mimirPool, {
        kind,
        question: String(p.question),
        labelA: String(p.creatorPosition),
        labelB: String(p.counterPosition),
        resolutionUrl: String(p.resolutionUrl),
        category: String(p.category),
        deadline: Number(p.deadline),
        stake,
        side: kind === "pool" ? sideOf(body, 1) : undefined,
      });
      return { transactions: [tx(call.to, call.data, stake, `open a ${kind === "vs" ? "VS" : "pool"} market staking ${p.stakeUnits} units (entry fee comes off it)`)] };
    }
    case "challenge": {
      const kind = kindOf(body);
      const stake = units6ToWei(p.stakeUnits as bigint);
      const id = Number(p.claimId);
      const call = stakeCall(kind === "vs" ? mimirV3 : mimirPool, kind, id, stake, kind === "vs" ? 2 : sideOf(body, 2));
      return { transactions: [tx(call.to, call.data, stake, `${kind === "vs" ? "challenge VS" : "stake on pool"} #${id}`)] };
    }
    case "dispute": {
      const kind = kindOf(body);
      const id = BigInt(p.claimId as bigint | number);
      const data =
        kind === "vs"
          ? encodeFunctionData({ abi: MIMIR_V3_ABI, functionName: "disputeResolution", args: [id] })
          : encodeFunctionData({ abi: MIMIR_POOL_ABI, functionName: "dispute", args: [id] });
      return { transactions: [tx(kind === "vs" ? mimirV3 : mimirPool, data, BOND, `dispute ${kind} #${id} with the 2 USDC bond`)] };
    }
    case "withdraw":
      return { transactions: [tx(mimirV3, encodeFunctionData({ abi: parseAbi(["function withdraw()"]), functionName: "withdraw" }), 0n, "pull a parked payout")] };
    default:
      throw new AgentEnvelopeError(`${write.action} is not needed on Arc: stakes are paid straight from the operator`, 410, "not_on_arc");
  }
}

export async function arcOperatorBalance(operator: Address): Promise<{ usdcWei: string }> {
  return { usdcWei: (await arcPublicClient().getBalance({ address: operator })).toString() };
}

/**
 * The contract's live limits for an agent stake (pause, early lock, launch caps), checked before a transaction is
 * prepared, so an agent gets the same plain reason the site shows instead of a bare revert. Throws a 409
 * AgentEnvelopeError("stake_limit"). Agents pay the standard entry fee (no holder ticket), so 50 bps is assumed.
 */
export async function assertArcStakeAllowed(
  write: { action: string; params: Record<string, unknown> },
  body: Record<string, unknown>,
  operator: Address,
): Promise<void> {
  if (write.action !== "challenge" && write.action !== "createClaim") return;
  const { mimirV3, mimirPool } = contracts();
  const kind = kindOf(body);
  const gross = units6ToWei(write.params.stakeUnits as bigint);
  const contract = kind === "vs" ? mimirV3 : mimirPool;
  const id = write.action === "challenge" ? Number(write.params.claimId) : 0;
  const limits = await readStakeLimits(arcPublicClient(), contract, id);
  let total = 0n;
  let mine = 0n;
  if (write.action === "challenge") {
    const m = (await arcMarketDetail(kind, id).catch(() => null)) as { stakeA: string; stakeB: string } | null;
    total = m ? BigInt(m.stakeA) + BigInt(m.stakeB) : 0n;
    if (kind === "pool") {
      const legs = (await arcPositions(operator).catch(() => [])) as Array<{ kind: string; marketId: number; amount: string }>;
      mine = legs.filter((p) => p.kind === "pool" && p.marketId === id).reduce((a, p) => a + BigInt(p.amount), 0n);
    }
  } else limits.lockAt = 0;
  const blocker = stakeLimitBlocker(limits, { kind, gross, entryBps: 50, mine, total, now: Math.floor(Date.now() / 1000) }, (wei) => `${Number(wei / 10n ** 12n) / 1e6} USDC`);
  if (blocker) throw new AgentEnvelopeError(blocker, 409, "stake_limit");
}

export async function arcOperatorPositions(operator: Address) {
  return arcPositions(operator);
}

// Same numbering as the Solana program and MimirV3: 0 open … 5 disputed.
const STATUS_OF = ["open", "active", "resolved", "cancelled", "proposed", "disputed"] as const;

/** Public markets from the index, filtered like the Solana listClaims (state numbers, category), newest first. */
export async function arcMarkets(f: { states?: number[]; category?: string; limit: number; kind?: unknown }) {
  const wanted = f.states ? new Set(f.states.map((s) => STATUS_OF[s])) : null;
  const kind = f.kind === "vs" || f.kind === "pool" ? f.kind : undefined;
  return (await arcMarketList(kind)).filter((m) => (!wanted || wanted.has(m.status)) && (!f.category || m.category === f.category)).slice(0, f.limit);
}

export async function arcMarket(kind: ArcMarketKind, marketId: number) {
  return arcMarketDetail(kind, marketId);
}
