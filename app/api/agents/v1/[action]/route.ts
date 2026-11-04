/**
 * POST /api/agents/v1/{action}: the agent API.
 *
 * One signed envelope format for everything (lib/agents/api.ts). Errors are
 * explicit: 400 for a malformed envelope or body, 401 for a rejected
 * credential, 403 with a named reason when authority, capability or a budget
 * refuses the action, 404 for an unknown agent, action or claim, 409 for a
 * replayed nonce, a taken agent id or on-chain state that makes the write
 * pointless, 429 for rate limits, 503 when the database or chain is down.
 *
 * On-chain writes never touch a key here: they return unsigned transactions on the
 * request's market chain (`chain`: "base", the default, or "arc") for the agent to
 * sign with its operator key (one EVM address on both chains) and send itself.
 */
import {
  AgentEnvelopeError,
  agentRequestMessage,
  CHAT_BIO_MAX,
  CHAT_MAX_PRICE_UNITS,
  CHAT_MIN_PAID_UNITS,
  isWriteAction,
  operatorProofMessage,
  validateAgentRequestEnvelope,
  type AgentEnvelope,
} from "@/lib/agents/api";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/agents/api-keys";
import { authenticateAgentRequest } from "@/lib/agents/authenticate";
import { MARKET_CHAINS } from "@/lib/chains/registry";
import { arcAgentsEnabled, arcMarket, arcMarkets, arcOperatorBalance, arcOperatorOf, arcOperatorPositions, assertArcStakeAllowed, prepareChainWrite } from "@/lib/agents/arc-chain";
import { deployPriceWei, recordDeployPayment, verifyDeployPayment } from "@/lib/server/agent-payment";
import { normalizeOwner } from "@/lib/owner";
import { dryRun } from "@/lib/agents/dry-run";
import { parseClaimId, parseWriteParams, stakeOf, unitsToUsdc, usdcLimitUnits } from "@/lib/agents/params";
import {
  authorizeAction,
  grantableCapabilities,
  isAuthorityLevel,
  isCapability,
  SELF_SERVICE_MAX_AUTHORITY,
  STAKING_ACTIONS,
  type AgentCapability,
  type AgentRecord,
  type AuthorityLevel,
} from "@/lib/agents/registry";
import { normalizeWallet, verifyWalletSignature } from "@/lib/agents/signature";
import {
  consumeNonce,
  createAgent,
  getAgent,
  getStoredResponse,
  insertApiKey,
  listApiKeys,
  recordRequest,
  releaseStake,
  reserveDailyStake,
  requestsLastHour,
  revokeAllApiKeys,
  revokeApiKey,
  rotateOperator,
  setArcOperator,
  setAgentChat,
  setAgentStatus,
  stakedLastDayUnits,
  storeResponse,
  touchAgent,
} from "@/lib/agents/store";
import { checkUrl } from "@/lib/research/ssrf";
import { storeEnabled } from "@/lib/server/store";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";
import { MAX_BODY_BYTES, readLimitedJson } from "@/lib/server/body-limit";
import { impersonatesReserved, isReservedAgentId } from "@/lib/agents/reserved";

export const dynamic = "force-dynamic";

/** Per client IP, before any work: caps a flood of garbage envelopes. */
const IP_LIMIT_PER_MIN = Number(process.env.AGENT_API_IP_PER_MIN ?? "240");
/** Per authenticated agent, on top of the hourly ceiling in its limits. */
const AGENT_LIMIT_PER_MIN = Number(process.env.AGENT_API_AGENT_PER_MIN ?? "60");

const LIVE_STATES = [0, 1];
const STATE_FILTERS: Record<string, number[]> = {
  open: [0],
  active: [1],
  live: LIVE_STATES,
  resolved: [2],
  cancelled: [3],
  proposed: [4],
  disputed: [5],
};

interface Ctx {
  params: Promise<{ action: string }>;
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

function fail(status: number, reason: string, message: string, extra: Record<string, string> = {}): Response {
  return json({ ok: false, reason, message }, status, extra);
}

function str(body: Record<string, unknown>, key: string, max = 120): string {
  const v = body[key];
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { action } = await ctx.params;

  if (!(await allowRequest("agent-api-ip", clientIp(req), IP_LIMIT_PER_MIN, 60_000))) {
    return fail(429, "rate_limit", "too many requests from this address", { "retry-after": "60" });
  }
  if (!storeEnabled()) {
    return fail(503, "registry_unavailable", "the agent registry is not configured on this deployment");
  }

  const read = await readLimitedJson(req);
  if (!read.ok) {
    return read.status === 413
      ? fail(413, "payload_too_large", `body is over ${MAX_BODY_BYTES} bytes`)
      : fail(400, "malformed_json", "body is not valid JSON");
  }
  const raw = read.value;

  let env: AgentEnvelope;
  try {
    env = validateAgentRequestEnvelope(raw, { action });
  } catch (err) {
    if (err instanceof AgentEnvelopeError) return fail(err.status, err.reason, err.message);
    throw err;
  }

  try {
    const result = env.action === "register"
      ? await handleRegister(env)
      : await handleAuthenticated(env, req.headers.get("authorization"));

    if (env.idempotencyKey && !result.replay) {
      await storeResponse(env.agentId, env.idempotencyKey, env.action, result.status, storable(env.action, result.body))
        .catch(() => undefined);
    }
    return json(result.body, result.status, result.replay ? { "idempotent-replay": "true" } : {});
  } catch (err) {
    if (err instanceof AgentEnvelopeError) {
      // Unknown ids are not audited, or anyone could grow the table without bound.
      if (err.reason !== "unknown_agent" && env.action !== "register") {
        await recordRequest(env.agentId, env.action, false, err.reason).catch(() => undefined);
      }
      return fail(err.status, err.reason, err.message);
    }
    console.error("[agents/v1] unhandled:", err);
    return fail(500, "internal_error", "the request could not be completed");
  }
}

interface Handled {
  status: number;
  body: unknown;
  replay?: boolean;
}

/**
 * Runs only after the caller has proven who they are. A retry with the same
 * idempotency key and action replays the stored answer rather than executing
 * again; issuing two API keys because a socket hiccuped is not a retry, it is a
 * second key nobody knows about. Otherwise the nonce is burned here.
 */
async function replayOrConsumeNonce(env: AgentEnvelope, nonce: string | null): Promise<Handled | null> {
  if (env.idempotencyKey) {
    const stored = await getStoredResponse(env.agentId, env.idempotencyKey, env.action).catch(() => null);
    if (stored) return { ...stored, replay: true };
  }
  if (nonce && !(await consumeNonce(env.agentId, nonce))) {
    throw new AgentEnvelopeError("nonce already used", 409, "nonce_replay");
  }
  return null;
}

/** A freshly issued key is shown once and never persisted, not even in the replay table. */
function storable(action: string, body: unknown): unknown {
  if (action !== "issueKey" || !body || typeof body !== "object") return body;
  const { key: _key, ...rest } = body as Record<string, unknown>;
  return { ...rest, key: null, note: "the key was shown once; revoke it by prefix if it was lost" };
}

/** Chain reads fail as a named 503, never with the RPC's own error text. */
async function onChain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AgentEnvelopeError) throw err;
    console.warn("[agents/v1] chain call failed:", err);
    throw new AgentEnvelopeError("the chain could not be read, try again shortly", 503, "chain_unavailable");
  }
}

// ── register ────────────────────────────────────────────────────────────────

async function handleRegister(env: AgentEnvelope): Promise<Handled> {
  // Persona slugs and house names (oracle, mimir, ...) are not for the taking,
  // neither as the id nor as a look-alike display name.
  const displayName = str(env.body, "displayName") || env.agentId;
  if (isReservedAgentId(env.agentId)) {
    throw new AgentEnvelopeError("that agent id is reserved", 409, "agent_id_reserved");
  }
  if (impersonatesReserved(displayName)) {
    throw new AgentEnvelopeError("that display name is reserved", 400, "display_name_reserved");
  }
  const ownerWallet = normalizeWallet(env.body.ownerWallet);
  const operatorWallet = normalizeWallet(env.body.operatorWallet);
  const payoutWallet = env.body.payoutWallet === undefined ? ownerWallet : normalizeWallet(env.body.payoutWallet);
  if (!ownerWallet || !operatorWallet || !payoutWallet) {
    throw new AgentEnvelopeError("ownerWallet, operatorWallet and payoutWallet must be EVM addresses", 400, "bad_wallets");
  }
  const authorityLevel = env.body.authorityLevel ?? 0;
  if (!isAuthorityLevel(authorityLevel)) {
    throw new AgentEnvelopeError("authorityLevel must be 0-4", 400, "bad_authority");
  }

  const requested = Array.isArray(env.body.capabilities) ? env.body.capabilities : [];
  const capabilities = requested.filter(isCapability) as AgentCapability[];
  if (capabilities.length !== requested.length) {
    throw new AgentEnvelopeError("unknown capability requested", 400, "bad_capability");
  }
  const grantable = grantableCapabilities(authorityLevel as AuthorityLevel);
  const overreach = capabilities.filter((c) => !grantable.includes(c));
  if (overreach.length > 0) {
    throw new AgentEnvelopeError(
      `${overreach.join(", ")} needs a higher authority level`,
      403,
      "capability_above_authority",
    );
  }

  // The owner signs the envelope, which is what actually creates the record.
  if (!env.signature) {
    throw new AgentEnvelopeError("registration needs an owner signature", 401, "owner_signature_required");
  }
  if (!env.nonce || env.signedAt === undefined) {
    throw new AgentEnvelopeError("registration needs a nonce and signedAt", 400, "missing_nonce");
  }
  const ownerOk = await verifyWalletSignature({
    address: ownerWallet,
    message: agentRequestMessage(env),
    signature: env.signature,
  });
  if (!ownerOk) {
    throw new AgentEnvelopeError("owner signature does not match", 401, "bad_signature");
  }

  // And the operator proves it controls itself, so an owner cannot enrol a hot
  // wallet they do not actually hold and strand positions against it.
  const operatorOk = await verifyWalletSignature({
    address: operatorWallet,
    message: operatorProofMessage(env.agentId, operatorWallet),
    signature: str(env.body, "operatorSignature", 128),
  });
  if (!operatorOk) {
    throw new AgentEnvelopeError("operator proof does not match", 401, "bad_operator_proof");
  }

  // Where the agent's transactions come from (one EVM operator for Base and Arc), and the deploy fee ($1), which is
  // paid on Arc in native USDC while Arc is configured (lib/server/agent-payment.ts).
  const arcOperator = env.body.arcOperator === undefined ? null : arcOperatorOf(env.body.arcOperator);
  if (env.body.arcOperator !== undefined && !arcOperator) {
    throw new AgentEnvelopeError("arcOperator must be a Solana public key", 400, "bad_wallets");
  }
  let payment: { hash: `0x${string}`; wei: bigint } | null = null;
  if (MARKET_CHAINS.chains.arc.enabled) {
    const wei = deployPriceWei();
    // The connected EVM wallet is the owner's account on Arc: it pays the fee itself.
    const ownerArc = normalizeOwner(ownerWallet) ?? "";
    payment = { hash: await onChain(() => verifyDeployPayment(env.body.paymentTx, wei, [ownerArc, arcOperator ?? ""])), wei };
  }

  const replay = await replayOrConsumeNonce(env, env.nonce);
  if (replay) return replay;

  if (await getAgent(env.agentId)) {
    throw new AgentEnvelopeError("that agent id is taken", 409, "agent_exists");
  }

  // The payment is spent first (its hash is unique), so one transaction can never pay for two agents.
  if (payment) {
    try {
      await recordDeployPayment(payment.hash, env.agentId, ownerWallet, payment.wei);
    } catch {
      throw new AgentEnvelopeError("that payment already paid for another agent", 409, "payment_used");
    }
  }
  const agent = await createAgent({
    agentId: env.agentId,
    ownerWallet,
    operatorWallet,
    payoutWallet,
    displayName,
    authorityLevel: authorityLevel as AuthorityLevel,
    capabilities,
    status: authorityLevel > SELF_SERVICE_MAX_AUTHORITY ? "pending" : "active",
    arcOperator,
  });

  await recordRequest(env.agentId, "register", true, null).catch(() => undefined);
  return { status: 201, body: { ok: true, agent: publicView(agent) } };
}

// ── everything else ─────────────────────────────────────────────────────────

/** Live markets the agent opened from its Arc operator (the index). */
async function activeMarketsOf(agent: AgentRecord): Promise<number> {
  if (!agent.arcOperator || !arcAgentsEnabled()) return 0;
  const operator = agent.arcOperator.toLowerCase();
  const live = await arcMarkets({ states: LIVE_STATES, limit: 10_000 }).catch(() => []);
  return (live as Array<{ creator?: string }>).filter((m) => m.creator === operator).length;
}

async function handleAuthenticated(env: AgentEnvelope, authorization: string | null): Promise<Handled> {
  const { agent, credential, nonce } = await authenticateAgentRequest(env, authorization);
  const replay = await replayOrConsumeNonce(env, nonce);
  if (replay) return replay;

  // Counted only once the caller is authenticated, so junk aimed at an agent
  // id cannot exhaust that agent's budget.
  if (!(await allowRequest("agent-api-agent", agent.agentId, AGENT_LIMIT_PER_MIN, 60_000))) {
    throw new AgentEnvelopeError(`over ${AGENT_LIMIT_PER_MIN} requests per minute`, 429, "rate_limit");
  }

  const used = await requestsLastHour(agent.agentId).catch(() => 0);
  const write = isWriteAction(env.action) ? parseWriteParams(env.action, env.body) : null;
  const stakeUnits = write ? stakeOf(write) : 0n;
  const budgeted = STAKING_ACTIONS.includes(env.action) || env.action === "dryRun";
  const spentUnits = budgeted ? await stakedLastDayUnits(agent.agentId).catch(() => 0n) : 0n;
  const activeMarkets = env.action === "createClaim" || env.action === "dryRun" ? await activeMarketsOf(agent) : 0;

  const decision = authorizeAction({
    agent,
    action: env.action,
    requestsLastHour: used,
    spentTodayUsdc: unitsToUsdc(spentUnits),
    activeMarkets,
    positionUsdc: unitsToUsdc(stakeUnits),
  });
  if (!decision.allowed) {
    await recordRequest(agent.agentId, env.action, false, decision.reason ?? null).catch(() => undefined);
    return {
      status: decision.reason === "rate_limit" ? 429 : 403,
      body: { ok: false, reason: decision.reason, message: decision.message },
    };
  }

  if (write) {
    // The check above read the total without a lock; this is the binding one:
    // the cap check and its record in a single locked step (audit P2-10).
    let reservation: string | null = null;
    if (stakeUnits > 0n) {
      reservation = await reserveDailyStake(agent.agentId, env.action, stakeUnits, usdcLimitUnits(agent.limits.maxDailyUsdc));
      if (reservation === null) {
        await recordRequest(agent.agentId, env.action, false, "daily_cap").catch(() => undefined);
        return {
          status: 403,
          body: { ok: false, reason: "daily_cap", message: `over ${agent.limits.maxDailyUsdc} USDC at risk today` },
        };
      }
    }
    if (!arcAgentsEnabled()) {
      if (reservation !== null) await releaseStake(reservation, "chain_unavailable").catch(() => undefined);
      throw new AgentEnvelopeError("markets are not configured on this deployment", 503, "chain_unavailable");
    }
    if (!agent.arcOperator) {
      if (reservation !== null) await releaseStake(reservation, "no_arc_operator").catch(() => undefined);
      throw new AgentEnvelopeError("set an operator first (setArcOperator): transactions are sent from it, on Solana Devnet", 409, "no_arc_operator");
    }
    const operator = agent.arcOperator;
    let arc;
    try {
      await onChain(() => assertArcStakeAllowed(write as unknown as { action: string; params: Record<string, unknown> }, env.body, operator));
      arc = await onChain(() => prepareChainWrite(write as unknown as { action: string; params: Record<string, unknown> }, env.body, operator));
    } catch (err) {
      if (reservation !== null) await releaseStake(reservation, "prepare_failed").catch(() => undefined);
      throw err;
    }
    if (reservation === null) await recordRequest(agent.agentId, env.action, true, null, stakeUnits).catch(() => undefined);
    return {
      status: 200,
      body: {
        ok: true,
        action: env.action,
        chain: arc.chain,
        signer: agent.arcOperator,
        transactions: arc.transactions,
        submit: "Sign the base64 transactions with the Solana operator key and submit them to the indicated devnet layer in order. Confirm each before continuing, and wait for any delegation to complete.",
      },
    };
  }

  await recordRequest(agent.agentId, env.action, true, null).catch(() => undefined);

  switch (env.action) {
    case "heartbeat": {
      await touchAgent(agent.agentId).catch(() => undefined);
      return {
        status: 200,
        body: { ok: true, agent: publicView(agent), credential, usage: { requestsLastHour: used } },
      };
    }

    case "dryRun": {
      const params = env.body.params;
      if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
        throw new AgentEnvelopeError("params must be an object", 400, "bad_params");
      }
      const result = await dryRun({
        agent,
        action: str(env.body, "action", 64) || "challenge",
        stakeUsdc: Number(env.body.stakeUsdc ?? 0) || 0,
        expectedPayoutUsdc: Number(env.body.expectedPayoutUsdc ?? 0) || 0,
        params: params as Record<string, unknown> | undefined,
        requestsLastHour: used,
        spentTodayUsdc: unitsToUsdc(spentUnits),
        activeMarkets,
      });
      return { status: 200, body: { ok: true, ...result } };
    }

    case "rotateOperator": {
      const next = normalizeWallet(env.body.operatorWallet);
      if (!next) throw new AgentEnvelopeError("operatorWallet must be a Solana public key", 400, "bad_wallets");
      const proofOk = await verifyWalletSignature({
        address: next,
        message: operatorProofMessage(agent.agentId, next),
        signature: str(env.body, "operatorSignature", 128),
      });
      if (!proofOk) {
        throw new AgentEnvelopeError("operator proof does not match", 401, "bad_operator_proof");
      }
      await rotateOperator(agent.agentId, next);
      // A rotation is what you do when the old key leaked, so the keys it could
      // have used go with it.
      await revokeAllApiKeys(agent.agentId);
      return { status: 200, body: { ok: true, operatorWallet: next, keysRevoked: true } };
    }

    case "setArcOperator": {
      const next = arcOperatorOf(env.body.arcOperator);
      if (!next) throw new AgentEnvelopeError("arcOperator must be a Solana public key", 400, "bad_wallets");
      await setArcOperator(agent.agentId, next);
      return { status: 200, body: { ok: true, arcOperator: next } };
    }

    case "issueKey": {
      const key = generateApiKey();
      await insertApiKey({
        keyHash: hashApiKey(key),
        agentId: agent.agentId,
        keyPrefix: apiKeyPrefix(key),
        label: str(env.body, "label") || "default",
        createdAt: Date.now(),
      });
      // Shown once. Only the SHA-256 is kept (the replay table stores a redacted
      // copy), so this cannot be re-read later.
      return { status: 201, body: { ok: true, key, prefix: apiKeyPrefix(key) } };
    }

    case "listKeys": {
      const keys = await listApiKeys(agent.agentId);
      return {
        status: 200,
        body: {
          ok: true,
          keys: keys.map((k) => ({
            prefix: k.keyPrefix,
            label: k.label,
            createdAt: k.createdAt,
            revokedAt: k.revokedAt,
          })),
        },
      };
    }

    case "revokeKey": {
      const prefix = str(env.body, "prefix", 64);
      if (!prefix) throw new AgentEnvelopeError("prefix is required", 400, "missing_prefix");
      const revoked = await revokeApiKey(agent.agentId, prefix);
      if (revoked === 0) throw new AgentEnvelopeError("no such active key", 404, "unknown_key");
      return { status: 200, body: { ok: true, revoked } };
    }

    case "setChat": {
      // The Mimir Terminal relays user messages to this endpoint, signed with the secret returned here.
      const url = str(env.body, "url", 300);
      if (url && (!url.startsWith("https://") || checkUrl(url))) {
        throw new AgentEnvelopeError("url must be a public https URL", 400, "bad_url");
      }
      const price = Number(env.body.priceUsdc ?? 0);
      const priceUnits = Math.round(price * 1e6);
      if (!Number.isFinite(price) || priceUnits < 0 || priceUnits > CHAT_MAX_PRICE_UNITS || (priceUnits > 0 && priceUnits < CHAT_MIN_PAID_UNITS)) {
        throw new AgentEnvelopeError("priceUsdc must be 0 (free) or between 0.001 and 1", 400, "bad_price");
      }
      const bio = str(env.body, "bio", CHAT_BIO_MAX);
      const { secret } = await setAgentChat(agent.agentId, { url, priceUnits, bio });
      // The secret is shown once (when the URL is new); keep it on the endpoint to verify requests.
      return { status: 200, body: { ok: true, enabled: Boolean(url), priceUsdc: priceUnits / 1e6, secret } };
    }

    case "revoke": {
      await setAgentStatus(agent.agentId, "revoked");
      await revokeAllApiKeys(agent.agentId);
      // Terminal on purpose: re-registering is a new record with a new history.
      return { status: 200, body: { ok: true, status: "revoked" } };
    }

    case "listClaims": {
      const stateKey = str(env.body, "state", 16).toLowerCase();
      const states = stateKey ? STATE_FILTERS[stateKey] : undefined;
      if (stateKey && !states) {
        throw new AgentEnvelopeError(`state must be one of ${Object.keys(STATE_FILTERS).join(", ")}`, 400, "bad_params");
      }
      const limit = Math.min(Math.max(Number(env.body.limit ?? 50) || 50, 1), 200);
      requireArc();
      const markets = await onChain(() => arcMarkets({ states, category: str(env.body, "category", 32) || undefined, limit, kind: env.body.kind, chain: env.body.chain }));
      return { status: 200, body: { ok: true, chain: env.body.chain ?? "all", source: "index", markets } };
    }

    case "getClaim": {
      const claimId = parseClaimId(env.body.claimId);
      requireArc();
      const market = await onChain(() => arcMarket(env.body.kind === "pool" ? "pool" : "vs", Number(claimId), env.body));
      if (!market) throw new AgentEnvelopeError(`market ${claimId} does not exist`, 404, "unknown_claim");
      return { status: 200, body: { ok: true, chain: market.chain, market } };
    }

    case "getBalances": {
      const operator = requireArcOperator(agent);
      return { status: 200, body: { ok: true, arcOperator: operator, ...(await onChain(() => arcOperatorBalance(operator, env.body))) } };
    }

    case "listPositions": {
      const operator = requireArcOperator(agent);
      const positions = await onChain(() => arcOperatorPositions(operator, env.body));
      return { status: 200, body: { ok: true, chain: env.body.chain ?? "all", source: "index", arcOperator: operator, positions } };
    }

    case "listEarnings": {
      return {
        status: 200,
        body: {
          ok: true,
          payoutWallet: agent.payoutWallet,
          // The contracts pay a referrer's share straight to it at payout: nothing accrues here to claim.
          note: "Referrer and copy fees are paid by the contracts (on Solana Devnet) directly to the wallet named in the stake.",
        },
      };
    }

    default:
      throw new AgentEnvelopeError(`${env.action} is not implemented`, 404, "unknown_action");
  }
}

function requireArc(): void {
  if (!arcAgentsEnabled()) throw new AgentEnvelopeError("markets are not configured on this deployment", 503, "chain_unavailable");
}

function requireArcOperator(agent: AgentRecord): string {
  requireArc();
  if (!agent.arcOperator) throw new AgentEnvelopeError("set an Arc operator first (setArcOperator)", 409, "no_arc_operator");
  return agent.arcOperator;
}

function publicView(agent: AgentRecord) {
  return {
    agentId: agent.agentId,
    displayName: agent.displayName,
    ownerWallet: agent.ownerWallet,
    operatorWallet: agent.operatorWallet,
    payoutWallet: agent.payoutWallet,
    authorityLevel: agent.authorityLevel,
    capabilities: agent.capabilities,
    status: agent.status,
    limits: agent.limits,
    createdAt: agent.createdAt,
    lastSeenAt: agent.lastSeenAt,
  };
}
