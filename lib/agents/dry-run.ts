import "server-only";

/**
 * Simulate an action without moving anything.
 *
 * The point is that a misconfigured agent fails cheap: it learns the policy
 * decision, the exact fee split it would pay, how much of its budget is left
 * and, for an on-chain write with params, what the program itself says about
 * the transaction (`simulateTransaction`, no signature) before it signs.
 */
import { PublicKey } from "@solana/web3.js";

import { DEFAULT_FEE_POLICY, splitFees, type FeePolicy } from "@/lib/solana/fees";

import { AgentEnvelopeError, isWriteAction } from "./api";
import { chainReader, prepareWrite, simulatePrepared, type SimulationResult } from "./chain";
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
  agentOwner: PublicKey | null;
}

export interface DryRunResult {
  action: string;
  allowed: boolean;
  reason?: string;
  message?: string;
  limits: AgentRecord["limits"];
  usage: { requestsLastHour: number; spentTodayUsdc: number; activeMarkets: number };
  feeQuote: {
    policy: FeePolicy;
    profitUsdc: string;
    platformFeeUsdc: string;
    agentOwnerFeeUsdc: string;
    netPayoutUsdc: string;
  } | null;
  /** Present when `params` described an on-chain write. Only the first transaction is simulated. */
  simulation: (SimulationResult & { layer: string; transactions: number }) | null;
}

const fmt = (units: bigint) => unitsToUsdc(units).toFixed(6);
const NONE = PublicKey.default.toBase58();

/** The fee policy the program is running, or the documented default when it cannot be read. */
export async function liveFeePolicy(): Promise<FeePolicy> {
  const cfg = await chainReader().getConfig().catch(() => null);
  if (!cfg) return DEFAULT_FEE_POLICY;
  const recipient = cfg.feeRecipient.toBase58();
  return {
    platformFeeBps: cfg.platformFeeBps,
    agentOwnerFeeBps: cfg.agentFeeBps,
    platformRecipient: recipient === NONE ? null : recipient,
  };
}

export async function dryRun(input: DryRunInput): Promise<DryRunResult> {
  const { agent, action, expectedPayoutUsdc = 0, params } = input;

  // Params are validated exactly as the real call would validate them.
  const parsed = params && isWriteAction(action) ? parseWriteParams(action, params) : null;
  const stakeUnits = parsed ? stakeOf(parsed) : input.stakeUsdc ? usdcToUnits(input.stakeUsdc, "stakeUsdc") : 0n;

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
    const policy = await liveFeePolicy();
    const split = splitFees({
      gross: usdcToUnits(expectedPayoutUsdc, "expectedPayoutUsdc"),
      principal: stakeUnits,
      policy,
      winner: agent.operatorWallet,
      agentOwner: input.agentOwner?.toBase58() ?? null,
    });
    feeQuote = {
      policy,
      profitUsdc: fmt(split.profit),
      platformFeeUsdc: fmt(split.platformFee),
      agentOwnerFeeUsdc: fmt(split.agentOwnerFee),
      netPayoutUsdc: fmt(split.netPayout),
    };
  }

  let simulation: DryRunResult["simulation"] = null;
  if (parsed) {
    try {
      const prepared = await prepareWrite(parsed, {
        operator: new PublicKey(agent.operatorWallet),
        agentOwner: input.agentOwner,
      });
      const first = prepared.transactions[0];
      if (first) {
        simulation = {
          ...(await simulatePrepared(first)),
          layer: first.layer,
          transactions: prepared.transactions.length,
        };
      }
    } catch (err) {
      // A pre-check refusal (paused, wrong layer, closed claim) is the answer;
      // an RPC failure is reported without its upstream text.
      const known = err instanceof AgentEnvelopeError;
      simulation = {
        ok: false,
        err: known ? err.reason : "simulation_unavailable",
        logs: known ? [err.message] : [],
        unitsConsumed: null,
        layer: "none",
        transactions: 0,
      };
    }
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
    simulation,
  };
}
