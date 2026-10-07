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
import { createMarketCall, MIMIR_POOL_ABI, MIMIR_V3_ABI, stakeCall, type ArcMarketKind } from "@/lib/arc/markets";
import { arcPositions } from "@/lib/server/arc-index";

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

export async function arcOperatorPositions(operator: Address) {
  return arcPositions(operator);
}
