/**
 * The agent API wire contract.
 *
 * Every request is the same signed envelope. The body is canonicalized (keys
 * sorted, compact JSON), hashed with SHA-256, and that hash goes into a
 * human-readable message the caller signs with its Solana key (ed25519). The
 * server re-derives the hash from the body it received, so a body cannot be
 * swapped after signing and the signer can read what they are agreeing to
 * before they sign it.
 *
 * Pure and isomorphic: the browser onboarding page and the Node SDK build the
 * exact same message the server verifies.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const AGENT_API_VERSION = "v1";

/**
 * On-chain writes. The API never holds a key: each of these returns unsigned
 * transactions for the agent to sign with its operator key and submit itself.
 */
export const AGENT_WRITE_ACTIONS = [
  "createClaim",
  "challenge",
  "dispute",
  "deposit",
  "delegateBalance",
  "undelegateBalance",
  "withdraw",
] as const;

export type AgentWriteAction = (typeof AGENT_WRITE_ACTIONS)[number];

/** Actions the API accepts today. */
export const AGENT_API_ACTIONS = [
  "register",
  "heartbeat",
  "rotateOperator",
  "listClaims",
  "getClaim",
  "getBalances",
  "listPositions",
  "listEarnings",
  "dryRun",
  "issueKey",
  "listKeys",
  "revokeKey",
  "revoke",
  ...AGENT_WRITE_ACTIONS,
] as const;

export type AgentAction = (typeof AGENT_API_ACTIONS)[number];

/** Actions only the owner wallet may authorize, never a bearer key. */
export const OWNER_SIGNED_ACTIONS: AgentAction[] = [
  "register",
  "rotateOperator",
  "issueKey",
  "listKeys",
  "revokeKey",
  "revoke",
];

/** An envelope older than this is rejected, so a captured request cannot be replayed later. */
export const AGENT_REQUEST_MAX_SKEW_MS = 5 * 60 * 1000;

export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export interface AgentEnvelope {
  version: string;
  agentId: string;
  action: AgentAction;
  idempotencyKey?: string;
  nonce?: string;
  signedAt?: number;
  body: Record<string, unknown>;
  /** Base58 ed25519 signature over `agentRequestMessage(envelope)`. */
  signature?: string;
}

export function isWriteAction(value: unknown): value is AgentWriteAction {
  return typeof value === "string" && (AGENT_WRITE_ACTIONS as readonly string[]).includes(value);
}

/**
 * Deterministic JSON: object keys sorted, no incidental whitespace. Two clients
 * that serialize the same body must produce the same bytes, or every signature
 * becomes a coin flip.
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Lowercase hex SHA-256 of the canonical body. */
export function bodyHash(body: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalize(body ?? {}))));
}

/** The exact text a caller signs. Readable on purpose: a signer should see what they approve. */
export function agentRequestMessage(env: AgentEnvelope): string {
  return [
    "Mimir Agent API request (Solana)",
    `version: ${env.version}`,
    `agent: ${env.agentId}`,
    `action: ${env.action}`,
    `idempotency: ${env.idempotencyKey ?? ""}`,
    `nonce: ${env.nonce ?? ""}`,
    `signedAt: ${env.signedAt ?? 0}`,
    `bodyHash: ${bodyHash(env.body)}`,
  ].join("\n");
}

/**
 * Proof that an operator wallet controls itself, required at registration.
 * Base58 is case-sensitive, so the key goes in exactly as given.
 */
export function operatorProofMessage(agentId: string, operatorWallet: string): string {
  return `Mimir agent operator proof (Solana)\nagent: ${agentId}\noperator: ${operatorWallet}`;
}

export class AgentEnvelopeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
  ) {
    super(message);
  }
}

const ENVELOPE_FIELDS = new Set([
  "version", "agentId", "action", "idempotencyKey", "nonce", "signedAt", "body", "signature",
]);

function isAction(value: unknown): value is AgentAction {
  return typeof value === "string" && (AGENT_API_ACTIONS as readonly string[]).includes(value);
}

/**
 * Structural validation only. Whether the signature is real, the nonce fresh
 * and the agent allowed is decided later, by code that can reach the database.
 */
export function validateAgentRequestEnvelope(
  raw: unknown,
  { action, now = Date.now() }: { action: string; now?: number },
): AgentEnvelope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentEnvelopeError("body must be a JSON object", 400, "malformed_envelope");
  }
  const env = raw as Record<string, unknown>;

  if (env.version !== AGENT_API_VERSION) {
    throw new AgentEnvelopeError(`version must be ${AGENT_API_VERSION}`, 400, "bad_version");
  }
  if (!isAction(action)) {
    throw new AgentEnvelopeError(`unknown action ${action}`, 404, "unknown_action");
  }
  // As the published schema says: `action` is required and nothing else rides
  // along, so a typo'd field fails loudly instead of being silently ignored.
  if (env.action === undefined) {
    throw new AgentEnvelopeError("action is required", 400, "missing_action");
  }
  if (env.action !== action) {
    throw new AgentEnvelopeError("action does not match the URL", 400, "action_mismatch");
  }
  const unknown = Object.keys(env).filter((k) => !ENVELOPE_FIELDS.has(k));
  if (unknown.length > 0) {
    throw new AgentEnvelopeError(`unknown envelope field(s): ${unknown.join(", ")}`, 400, "unknown_field");
  }
  if (typeof env.agentId !== "string" || !AGENT_ID_PATTERN.test(env.agentId)) {
    throw new AgentEnvelopeError(
      "agentId must be 3-64 chars of [a-z0-9-], starting alphanumeric",
      400,
      "bad_agent_id",
    );
  }
  if (env.body !== undefined && (typeof env.body !== "object" || env.body === null || Array.isArray(env.body))) {
    throw new AgentEnvelopeError("body must be an object", 400, "bad_body");
  }
  for (const field of ["idempotencyKey", "nonce"] as const) {
    const v = env[field];
    if (v !== undefined && (typeof v !== "string" || v.length === 0 || v.length > 128)) {
      throw new AgentEnvelopeError(`${field} must be 1-128 chars`, 400, `bad_${field}`);
    }
  }
  if (env.signedAt !== undefined) {
    if (typeof env.signedAt !== "number" || !Number.isFinite(env.signedAt)) {
      throw new AgentEnvelopeError("signedAt must be a number", 400, "bad_signed_at");
    }
    if (Math.abs(now - env.signedAt) > AGENT_REQUEST_MAX_SKEW_MS) {
      throw new AgentEnvelopeError("signedAt is outside the allowed window", 400, "stale_envelope");
    }
  }
  if (env.signature !== undefined && typeof env.signature !== "string") {
    throw new AgentEnvelopeError("signature must be a string", 400, "bad_signature");
  }

  return {
    version: AGENT_API_VERSION,
    agentId: env.agentId,
    action,
    idempotencyKey: env.idempotencyKey as string | undefined,
    nonce: env.nonce as string | undefined,
    signedAt: env.signedAt as number | undefined,
    body: (env.body as Record<string, unknown>) ?? {},
    signature: env.signature as string | undefined,
  };
}
