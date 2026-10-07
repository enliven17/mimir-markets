/**
 * POST /api/copy/signals: what this execution agent may copy, and the
 * unsigned transaction to do it.
 *
 * Authenticated as the execution agent with the same signed envelope every
 * agent call uses (`action: "heartbeat"`: asking is a read, and every copy it
 * then places is gated by the follower's permission and the agent's own
 * limits). Three modes, chosen by the envelope body:
 *
 *   {}                                   gated instructions: copy[] and skipped[]
 *   { prepare: { permissionId, claimId } }  re-gates that one copy and returns
 *                                          the unsigned challenge transaction
 *                                          (lib/agents/chain.ts; ER when delegated)
 *   { report: { permissionId, claimId, executed, signature?, skipReason? } }
 *                                          records the outcome in the ledger
 *
 * Nothing is staked here and no key is held: the agent signs and submits with
 * its operator key. An executed report is checked against the claim account
 * on chain and recorded at the operator's actual stake, so the ledger the caps
 * are derived from cannot be talked down.
 */
import { zeroAddress } from "viem";
import { ARC } from "@/lib/arc/config";
import { stakeCall } from "@/lib/arc/markets";
import { getArcBinding } from "@/lib/server/arc-accounts";
import { arcPositions } from "@/lib/server/arc-index";
import { getAgent } from "@/lib/agents/store";
import { PublicKey } from "@solana/web3.js";

import {
  AgentEnvelopeError,
  validateAgentRequestEnvelope,
  type AgentEnvelope,
} from "@/lib/agents/api";
import { authenticateAgentRequest } from "@/lib/agents/authenticate";
import { prepareWrite, readClaim } from "@/lib/agents/chain";
import { unitsToUsdc, usdcLimitUnits } from "@/lib/agents/params";
import { authorizeAction, type AgentRecord } from "@/lib/agents/registry";
import {
  consumeNonce,
  recordRequest,
  releaseStake,
  requestsLastHour,
  reserveDailyStake,
  stakedLastDayUnits,
} from "@/lib/agents/store";
import { copyStakeUnits, isCopySkipReason, type CopyPermission } from "@/lib/copy-trading";
import type { CopyInstruction } from "@/lib/copy-signals";
import { permissionsForExecutor, recordExecution, releaseCopy, reserveCopy } from "@/lib/copy-trading-store";
import { buildCopyInstructions } from "@/lib/server/copy-signals";
import { isFeatureEnabled } from "@/lib/ops/flags";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail as fail, basketJson as json } from "@/lib/server/basket-http";
import { MAX_BODY_BYTES, readLimitedJson } from "@/lib/server/body-limit";

export const dynamic = "force-dynamic";

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** Only MONETISE agents are credited on chain for the agent fee, as in the agent API. */
function agentOwnerFor(agent: AgentRecord): PublicKey | null {
  return agent.status === "active" && agent.capabilities.includes("fee_earner")
    ? new PublicKey(agent.payoutWallet)
    : null;
}

function target(raw: unknown): { permissionId: string; claimId: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const permissionId = typeof r.permissionId === "string" ? r.permissionId.trim() : "";
  const claimId = Number(r.claimId);
  if (!permissionId || !Number.isSafeInteger(claimId) || claimId <= 0) return null;
  return { permissionId, claimId };
}

function view(i: CopyInstruction) {
  return {
    permissionId: i.permissionId,
    claimId: i.claimId,
    signalAgentId: i.signalAgentId,
    question: i.question,
    category: i.category,
    layer: i.layer,
    deadline: i.deadline,
    claimQuality: i.claimQuality,
    payoutRatio: i.payoutRatio,
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!isFeatureEnabled("copy_trading")) {
    return fail(404, "feature_disabled", "copy trading is not enabled on this deployment");
  }
  if (!(await allowRequest("copy-signals-ip", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  if (!isDbEnabled()) return fail(503, "registry_unavailable", "copy trading needs a database on this deploy");

  const read = await readLimitedJson(req);
  if (!read.ok) {
    return read.status === 413
      ? fail(413, "payload_too_large", `body is over ${MAX_BODY_BYTES} bytes`)
      : fail(400, "malformed_json", "body is not valid JSON");
  }
  const raw = read.value;

  let env: AgentEnvelope;
  let agent: AgentRecord;
  try {
    env = validateAgentRequestEnvelope(raw, { action: "heartbeat" });
    const auth = await authenticateAgentRequest(env, req.headers.get("authorization"));
    if (auth.nonce && !(await consumeNonce(auth.agent.agentId, auth.nonce))) {
      throw new AgentEnvelopeError("nonce already used", 409, "nonce_replay");
    }
    agent = auth.agent;
  } catch (err) {
    if (err instanceof AgentEnvelopeError) return fail(err.status, err.reason, err.message);
    console.error("[copy/signals] auth failed:", err);
    return fail(503, "registry_unavailable", "the agent registry could not be read");
  }
  if (!(await allowRequest("copy-signals-agent", agent.agentId, 30, 60_000))) return tooManyRequests(60);

  const permissions = await permissionsForExecutor(agent.agentId).catch(() => [] as CopyPermission[]);

  try {
    if (env.body.report !== undefined) return await handleReport(agent, permissions, env.body.report);
    if (env.body.prepare !== undefined) return await handlePrepare(agent, permissions, env.body.prepare);
  } catch (err) {
    if (err instanceof AgentEnvelopeError) return fail(err.status, err.reason, err.message);
    console.error("[copy/signals] failed:", err);
    return fail(503, "chain_unavailable", "the chain could not be read, try again shortly");
  }

  const instructions = await buildCopyInstructions(permissions, executorAddress(agent)).catch(() => []);
  await recordRequest(agent.agentId, "copySignals", true, null).catch(() => undefined);
  return json({
    ok: true,
    executionAgentId: agent.agentId,
    signer: onArc() ? agent.arcOperator : agent.operatorWallet,
    permissions: permissions.length,
    copy: instructions
      .filter((i) => i.decision.allowed)
      .map((i) => ({
        ...view(i),
        stakeUsdc: i.decision.stakeUsdc,
        stakeUnits: copyStakeUnits(i.decision.stakeUsdc).toString(),
      })),
    skipped: instructions
      .filter((i) => !i.decision.allowed)
      .map((i) => ({ ...view(i), reason: i.decision.reason, message: i.decision.message })),
    // Said plainly, because an endpoint returning stake sizes could be read as
    // having already placed them.
    note:
      "Nothing has been staked. For each copy, call again with { prepare: { permissionId, claimId } }, sign the returned transactions with the operator key, then report { report: { permissionId, claimId, executed: true, signature } }.",
  });
}

async function handlePrepare(agent: AgentRecord, permissions: CopyPermission[], raw: unknown): Promise<Response> {
  const t = target(raw);
  if (!t) return fail(400, "bad_prepare", "prepare needs permissionId and a positive integer claimId");
  const permission = permissions.find((p) => p.id === t.permissionId);
  if (!permission) {
    return fail(403, "not_your_permission", "no active permission names this agent as its executor under that id");
  }

  // Re-gated at prepare time: the list a moment ago is advice, this is the decision.
  if (onArc() && !agent.arcOperator) return fail(409, "no_arc_operator", "set an Arc operator first (setArcOperator): copies are sent from it");
  const instructions = await buildCopyInstructions([permission], executorAddress(agent));
  const instruction = instructions.find((i) => i.claimId === t.claimId);
  if (!instruction) {
    return fail(409, "no_signal", "the signal agent holds no open position you can copy on that claim");
  }
  if (!instruction.decision.allowed) {
    return json(
      { ok: false, reason: instruction.decision.reason, message: instruction.decision.message },
      { status: 409 },
    );
  }

  // The agent's own limits still apply on top of the follower's policy.
  const stakeUnits = copyStakeUnits(instruction.decision.stakeUsdc);
  const [used, spentUnits] = await Promise.all([
    requestsLastHour(agent.agentId).catch(() => 0),
    stakedLastDayUnits(agent.agentId).catch(() => 0n),
  ]);
  const decision = authorizeAction({
    agent,
    action: "challenge",
    requestsLastHour: used,
    spentTodayUsdc: unitsToUsdc(spentUnits),
    positionUsdc: unitsToUsdc(stakeUnits),
  });
  if (!decision.allowed) {
    await recordRequest(agent.agentId, "challenge", false, decision.reason ?? null).catch(() => undefined);
    return fail(decision.reason === "rate_limit" ? 429 : 403, decision.reason ?? "denied", decision.message ?? "");
  }

  // The follower's reservation first: it counts toward their caps until this
  // copy is reported or expires, and a live one blocks a duplicate prepare.
  const reserved = await reserveCopy(permission.id, t.claimId, instruction.decision.stakeUsdc, permission);
  if (reserved === "duplicate") {
    return fail(409, "already_prepared", "this copy was already prepared: report it before preparing again");
  }
  if (reserved === "over_cap") {
    return fail(409, "follower_cap", "the follower's daily or weekly copy limit is reached");
  }
  // Then the agent's own daily cap, checked and recorded in one locked step.
  const reservation = await reserveDailyStake(
    agent.agentId,
    "challenge",
    stakeUnits,
    usdcLimitUnits(agent.limits.maxDailyUsdc),
  ).catch(async (err) => {
    await releaseCopy(permission.id, t.claimId).catch(() => undefined);
    throw err;
  });
  if (reservation === null) {
    await releaseCopy(permission.id, t.claimId).catch(() => undefined);
    await recordRequest(agent.agentId, "challenge", false, "daily_cap").catch(() => undefined);
    return fail(403, "daily_cap", `over ${agent.limits.maxDailyUsdc} USDC at risk today`);
  }

  if (onArc()) {
    const referrer = await copyReferrer(permission.signalAgentId).catch(() => zeroAddress);
    const call = stakeCall(ARC.contracts.mimirV3!, "vs", t.claimId, stakeUnits * 1_000_000_000_000n, 2, referrer);
    return json({
      ok: true,
      chain: "arc",
      permissionId: permission.id,
      claimId: t.claimId,
      stakeUsdc: instruction.decision.stakeUsdc,
      stakeUnits: stakeUnits.toString(),
      signer: agent.arcOperator,
      referrer,
      transactions: [{ chainId: ARC.chain.id, to: call.to, data: call.data, value: String(call.value ?? 0n), description: `copy: challenge VS #${t.claimId}` }],
      submit: "Sign the transaction with the Arc operator key (value is native USDC in wei), send it to Arc, then report the tx hash.",
    });
  }

  let prepared;
  try {
    prepared = await prepareWrite(
      { action: "challenge", params: { claimId: BigInt(t.claimId), stakeUnits } },
      { operator: new PublicKey(agent.operatorWallet), agentOwner: agentOwnerFor(agent) },
    );
  } catch (err) {
    await Promise.all([
      releaseStake(reservation, "prepare_failed").catch(() => undefined),
      releaseCopy(permission.id, t.claimId).catch(() => undefined),
    ]);
    throw err;
  }
  return json({
    ok: true,
    permissionId: permission.id,
    claimId: t.claimId,
    stakeUsdc: instruction.decision.stakeUsdc,
    stakeUnits: stakeUnits.toString(),
    signer: agent.operatorWallet,
    transactions: prepared.transactions,
    submit:
      "Sign each transaction with the operator key and send it to its layer, in order, then report the last signature.",
  });
}

async function handleReport(agent: AgentRecord, permissions: CopyPermission[], raw: unknown): Promise<Response> {
  const t = target(raw);
  if (!t) return fail(400, "bad_report", "report needs permissionId and a positive integer claimId");
  const r = raw as Record<string, unknown>;
  if (!permissions.some((p) => p.id === t.permissionId)) {
    return fail(403, "not_your_permission", "no active permission names this agent as its executor under that id");
  }

  if (r.executed !== true) {
    await releaseCopy(t.permissionId, t.claimId).catch(() => undefined);
    await recordExecution({
      permissionId: t.permissionId,
      claimId: t.claimId,
      executed: false,
      skipReason: isCopySkipReason(r.skipReason) ? r.skipReason : null,
    }).catch(() => undefined);
    return json({ ok: true, recorded: { ...t, executed: false } });
  }

  const signature = typeof r.signature === "string" ? r.signature.trim() : "";
  if (onArc()) {
    if (signature && !/^0x[0-9a-fA-F]{64}$/.test(signature)) return fail(400, "bad_report", "signature must be the Arc tx hash");
    // The index is the source of truth for whether the copy landed and for how much.
    const legs = agent.arcOperator ? await arcPositions(agent.arcOperator).catch(() => []) : [];
    const leg = legs.find((p) => p.kind === "vs" && p.marketId === t.claimId && p.side === 2);
    if (!leg) return fail(409, "not_on_chain", "the Arc operator holds no challenge on that market yet (the index updates within seconds)");
    const stakeUsdc = unitsToUsdc(BigInt(leg.amount) / 1_000_000_000_000n);
    const recorded = await recordExecution({ permissionId: t.permissionId, claimId: t.claimId, executed: true, stakeUsdc, txSignature: signature || null });
    await releaseCopy(t.permissionId, t.claimId).catch(() => undefined);
    return json({ ok: true, recorded: { ...t, executed: true, stakeUsdc }, duplicate: !recorded });
  }
  if (signature && !BASE58_SIGNATURE.test(signature)) {
    return fail(400, "bad_report", "signature must be a base58 Solana transaction signature");
  }
  // The claim account is the source of truth for whether the copy landed and
  // for how much: a report cannot claim a smaller stake than was placed.
  const found = await readClaim(BigInt(t.claimId));
  const position = found?.claim.challengers.find((ch) => ch.addr.toBase58() === agent.operatorWallet);
  if (!position) {
    return fail(409, "not_on_chain", "the operator wallet holds no position on that claim yet");
  }
  const stakeUsdc = unitsToUsdc(position.stake);
  const recorded = await recordExecution({
    permissionId: t.permissionId,
    claimId: t.claimId,
    executed: true,
    stakeUsdc,
    txSignature: signature || null,
  });
  // The executed row now carries the spend; the provisional one goes.
  await releaseCopy(t.permissionId, t.claimId).catch(() => undefined);
  return json({ ok: true, recorded: { ...t, executed: true, stakeUsdc }, duplicate: !recorded });
}

/** Copies run on Arc once its contracts are configured. */
function onArc(): boolean {
  return Boolean(ARC.contracts.mimirV3 && process.env.NEXT_PUBLIC_CONVEX_URL);
}

/** Where the executing agent stakes from: its Arc operator on Arc, its Solana operator wallet otherwise. */
function executorAddress(agent: AgentRecord): string {
  return onArc() ? (agent.arcOperator ?? "").toLowerCase() : agent.operatorWallet;
}

/**
 * Who earns the 1% referrer share of a winning copy: the copied agent's owner (their bound Arc account, else the
 * agent's Arc operator). House personas have no owner to pay, so their copies carry no referrer and no copy fee.
 */
async function copyReferrer(signalAgentId: string): Promise<`0x${string}`> {
  const signal = await getAgent(signalAgentId).catch(() => null);
  if (!signal) return zeroAddress;
  const owner = (await getArcBinding(signal.ownerWallet).catch(() => null))?.arc;
  return (owner ?? signal.arcOperator ?? zeroAddress) as `0x${string}`;
}
