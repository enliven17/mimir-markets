import "server-only";

/**
 * Simulate an action without moving anything.
 *
 * The point is that a misconfigured agent fails cheap: it learns the policy
 * decision, the fee split it would pay, how much of its budget is left and,
 * for a write with params, whether the params validate, before it signs.
 */
import { splitFees, type FeePolicy } from "@/lib/solana/fees";
import { Keypair } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";

import { isWriteAction } from "./api";
import { parseWriteParams, stakeOf, unitsToUsdc, usdcToUnits } from "./params";
import { authorizeAction, type AgentRecord } from "./registry";

export interface DryRunInput {
  agent: AgentRecord;
  action: string;
  /** USDC this call would stake (ignored when `params` gives the stake). */
  stakeUsdc?: number;
  /** Payout the agent expects if it wins, USDC. Used to quote the fee split. */
  expectedPayoutUsdc?: number;
  /** The body the real write would carry; when present the transaction is built and simulated. */
  params?: Record<string, unknown>;
  requestsLastHour: number;
  spentTodayUsdc: number;
  activeMarkets: number;
}

export interface DryRunResult {
  action: string;
  allowed: boolean;
  reason?: string;
  message?: string;
  limits: AgentRecord["limits"];
  usage: {
    requestsLastHour: number;
    spentTodayUsdc: number;
    activeMarkets: number;
  };
  feeQuote: {
    policy: FeePolicy;
    profitUsdc: string;
    platformFeeUsdc: string;
    agentOwnerFeeUsdc: string;
    netPayoutUsdc: string;
  } | null;
}

const fmt = (units: bigint) => unitsToUsdc(units).toFixed(6);
/** The contracts' default fee policy (lib/market-fees.ts). */
export async function liveFeePolicy(claimId?: bigint): Promise<FeePolicy> {
  const client = new MimirSolanaClient(Keypair.generate());
  const source =
    claimId === undefined
      ? await client.getConfig()
      : await client.getClaim(claimId);
  if (!source) throw new Error("Native fee policy unavailable");
  return {
    platformFeeBps: source.platformFeeBps,
    agentOwnerFeeBps: source.agentFeeBps,
    platformRecipient: source.feeRecipient.toBase58(),
  };
}

export async function dryRun(input: DryRunInput): Promise<DryRunResult> {
  const { agent, action, expectedPayoutUsdc = 0, params } = input;

  // Params are validated exactly as the real call would validate them.
  const parsed =
    params && isWriteAction(action) ? parseWriteParams(action, params) : null;
  const stakeUnits = parsed
    ? stakeOf(parsed)
    : input.stakeUsdc
      ? usdcToUnits(input.stakeUsdc, "stakeUsdc")
      : 0n;

  const decision = authorizeAction({
    agent,
    action,
    requestsLastHour: input.requestsLastHour,
    spentTodayUsdc: input.spentTodayUsdc,
    activeMarkets: input.activeMarkets,
    positionUsdc: unitsToUsdc(stakeUnits),
  });

  let feeQuote: DryRunResult["feeQuote"] = null;
  if (stakeUnits > 0n && expectedPayoutUsdc > 0) {
    const policy = await liveFeePolicy(
      parsed && "claimId" in parsed.params ? parsed.params.claimId : undefined,
    );
    const split = splitFees({
      gross: usdcToUnits(expectedPayoutUsdc, "expectedPayoutUsdc"),
      principal: stakeUnits,
      policy,
      winner: agent.arcOperator ?? agent.operatorWallet,
      agentOwner: null,
    });
    feeQuote = {
      policy,
      profitUsdc: fmt(split.profit),
      platformFeeUsdc: fmt(split.platformFee),
      agentOwnerFeeUsdc: fmt(split.agentOwnerFee),
      netPayoutUsdc: fmt(split.netPayout),
    };
  }

  return {
    action,
    allowed: decision.allowed,
    reason: decision.reason,
    message: decision.message,
    limits: agent.limits,
    usage: {
      requestsLastHour: input.requestsLastHour,
      spentTodayUsdc: input.spentTodayUsdc,
      activeMarkets: input.activeMarkets,
    },
    feeQuote,
  };
}
