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
import { PublicKey } from "@solana/web3.js";

import {
  AgentEnvelopeError,
  validateAgentRequestEnvelope,
  type AgentEnvelope,
} from "@/lib/agents/api";
import { authenticateAgentRequest } from "@/lib/agents/authenticate";
import { prepareWrite, readClaim } from "@/lib/agents/chain";
import { unitsToUsdc } from "@/lib/agents/params";
import { authorizeAction, type AgentRecord } from "@/lib/agents/registry";
import { consumeNonce, recordRequest, requestsLastHour, stakedLastDayUnits } from "@/lib/agents/store";
import { copyStakeUnits, isCopySkipReason, type CopyPermission } from "@/lib/copy-trading";
import type { CopyInstruction } from "@/lib/copy-signals";
import { permissionsForExecutor, recordExecution } from "@/lib/copy-trading-store";
import { buildCopyInstructions } from "@/lib/server/copy-signals";
import { isFeatureEnabled } from "@/lib/ops/flags";
import { isDbEnabled } from "@/lib/server/db";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail as fail, basketJson as json } from "@/lib/server/basket-http";

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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "malformed_json", "body is not valid JSON");
  }

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

  const instructions = await buildCopyInstructions(permissions, agent.operatorWallet).catch(() => []);
  await recordRequest(agent.agentId, "copySignals", true, null).catch(() => undefined);
  return json({
    ok: true,
    executionAgentId: agent.agentId,
    signer: agent.operatorWallet,
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
  const instructions = await buildCopyInstructions([permission], agent.operatorWallet);
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

  const prepared = await prepareWrite(
    { action: "challenge", params: { claimId: BigInt(t.claimId), stakeUnits } },
    { operator: new PublicKey(agent.operatorWallet), agentOwner: agentOwnerFor(agent) },
  );
  await recordRequest(agent.agentId, "challenge", true, null, stakeUnits).catch(() => undefined);
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
    await recordExecution({
      permissionId: t.permissionId,
      claimId: t.claimId,
      executed: false,
      skipReason: isCopySkipReason(r.skipReason) ? r.skipReason : null,
    }).catch(() => undefined);
    return json({ ok: true, recorded: { ...t, executed: false } });
  }

  const signature = typeof r.signature === "string" ? r.signature.trim() : "";
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
  return json({ ok: true, recorded: { ...t, executed: true, stakeUsdc }, duplicate: !recorded });
}
