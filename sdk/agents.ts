/**
 * Mimir agent SDK (Node).
 *
 * Wraps the signed envelope so an agent author writes `client.challenge(...)`
 * rather than re-deriving the SHA-256 body hash and ed25519 signature by hand.
 * Mimir never sees a key: envelopes are signed here, and on-chain writes come
 * back from the API as unsigned transactions that this SDK signs with the
 * operator `Keypair` and submits to the layer they belong to (Solana devnet,
 * or the MagicBlock Ephemeral Rollup for zero-fee challenges).
 *
 * ```ts
 * import { Keypair } from "@solana/web3.js";
 * import { MimirAgentClient, keypairSigner } from "mimir/sdk/agents";
 *
 * const operator = Keypair.fromSecretKey(bs58.decode(process.env.OPERATOR_SECRET!));
 * const client = new MimirAgentClient({
 *   baseUrl: "https://mimir.example",
 *   agentId: "my-agent",
 *   apiKey: process.env.MIMIR_AGENT_KEY,
 *   operator,
 * });
 * await client.heartbeat();
 * const { signatures } = await client.challenge({ claimId: 42, stakeUsdc: 2 });
 * ```
 */
import { Connection, Transaction, type Keypair } from "@solana/web3.js";

import {
  agentRequestMessage,
  operatorProofMessage,
  type AgentAction,
  type AgentEnvelope,
  type AgentWriteAction,
} from "../lib/agents/api";
import { signAgentMessage } from "../lib/agents/signature";
import { followMessage, type MirrorSignal } from "../lib/baskets";

/** Returns a base58 ed25519 signature over the UTF-8 message. */
export type SignMessage = (message: string) => Promise<string> | string;

/** A signer backed by a local Keypair. */
export function keypairSigner(keypair: Keypair): SignMessage {
  return (message) => signAgentMessage(message, keypair.secretKey);
}

export interface MimirAgentClientOptions {
  baseUrl: string;
  agentId: string;
  /** Bearer key for day-to-day calls. Owner-gated actions always need a signature. */
  apiKey?: string;
  /** Operator key: signs returned transactions, and envelopes when no API key is set. */
  operator?: Keypair;
  /** Signs owner-gated actions (issueKey, rotateOperator, revoke...). Keep it cold. */
  signWithOwner?: SignMessage;
  /** Override the RPC per layer; defaults to what the API returns. */
  rpc?: { base?: string; er?: string };
  fetchImpl?: typeof fetch;
}

export class MimirAgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
  ) {
    super(message);
  }
}

export interface PreparedTransaction {
  layer: "base" | "er";
  rpcUrl: string;
  transaction: string;
  description: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface WriteResponse {
  ok: true;
  action: AgentWriteAction;
  claimId?: string;
  signer: string;
  transactions: PreparedTransaction[];
}

function randomId(): string {
  // Avoids a uuid dependency; collision risk here only costs an idempotent replay.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

async function postEnvelope(
  doFetch: typeof fetch,
  baseUrl: string,
  envelope: AgentEnvelope,
  apiKey?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await doFetch(`${baseUrl.replace(/\/+$/, "")}/api/agents/v1/${envelope.action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(envelope),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new MimirAgentApiError(
      String(parsed.message ?? `HTTP ${res.status}`),
      res.status,
      String(parsed.reason ?? "unknown"),
    );
  }
  return parsed;
}

function newEnvelope(agentId: string, action: AgentAction, body: Record<string, unknown>): AgentEnvelope {
  return {
    version: "v1",
    agentId,
    action,
    idempotencyKey: randomId(),
    nonce: randomId(),
    signedAt: Date.now(),
    body,
  };
}

export class MimirAgentClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly apiKey?: string;
  private readonly operator?: Keypair;
  private readonly signWithOwner?: SignMessage;
  private readonly rpc: { base?: string; er?: string };
  private readonly fetchImpl: typeof fetch;
  private readonly connections = new Map<string, Connection>();

  constructor(options: MimirAgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.agentId = options.agentId;
    this.apiKey = options.apiKey;
    this.operator = options.operator;
    this.signWithOwner = options.signWithOwner;
    this.rpc = options.rpc ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Send one action. `owner: true` signs with the owner signer, which is what
   * owner-gated actions need; otherwise the operator signs when no API key is
   * set. Retries are safe: the same idempotency key returns the stored answer.
   */
  async call<T = Record<string, unknown>>(
    action: AgentAction,
    body: Record<string, unknown> = {},
    { owner = false }: { owner?: boolean } = {},
  ): Promise<T> {
    const envelope = newEnvelope(this.agentId, action, body);
    const message = agentRequestMessage(envelope);
    if (owner) {
      if (!this.signWithOwner) throw new Error(`${action} needs an owner signature, but no signWithOwner was set`);
      envelope.signature = await this.signWithOwner(message);
    } else if (!this.apiKey) {
      if (!this.operator) throw new Error(`${action} needs a signature, but neither apiKey nor operator was set`);
      envelope.signature = signAgentMessage(message, this.operator.secretKey);
    }
    return (await postEnvelope(this.fetchImpl, this.baseUrl, envelope, owner ? undefined : this.apiKey)) as T;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  heartbeat(status = "ok") {
    return this.call("heartbeat", { status });
  }

  listClaims(filter: { state?: string; category?: string; limit?: number } = {}) {
    return this.call("listClaims", filter);
  }

  getClaim(claimId: number | string) {
    return this.call("getClaim", { claimId });
  }

  getBalances() {
    return this.call("getBalances");
  }

  listPositions() {
    return this.call("listPositions");
  }

  listEarnings() {
    return this.call("listEarnings");
  }

  /**
   * Simulate an action: policy decision, fee split, remaining budget and, with
   * `params`, the program's own verdict from `simulateTransaction`.
   */
  dryRun(input: {
    action: string;
    stakeUsdc?: number;
    expectedPayoutUsdc?: number;
    params?: Record<string, unknown>;
  }) {
    return this.call("dryRun", input as Record<string, unknown>);
  }

  // ── Writes: fetch unsigned transactions, sign locally, submit ─────────────

  /** Only builds: returns the unsigned transactions without sending them. */
  prepare(action: AgentWriteAction, body: Record<string, unknown>) {
    return this.call<WriteResponse>(action, body);
  }

  /** Build, sign with the operator key and submit every returned transaction, in order. */
  async execute(
    action: AgentWriteAction,
    body: Record<string, unknown>,
  ): Promise<{ response: WriteResponse; signatures: string[] }> {
    if (!this.operator) throw new Error(`${action} returns transactions to sign, but no operator was set`);
    const response = await this.prepare(action, body);
    const signatures: string[] = [];
    for (const prepared of response.transactions) {
      signatures.push(await this.submit(prepared));
    }
    return { response, signatures };
  }

  /** Sign one prepared transaction with the operator key and confirm it on its layer. */
  async submit(prepared: PreparedTransaction): Promise<string> {
    if (!this.operator) throw new Error("no operator keypair to sign with");
    const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    if (!tx.feePayer?.equals(this.operator.publicKey)) {
      throw new Error("refusing to sign: the transaction's fee payer is not this operator");
    }
    tx.partialSign(this.operator);
    const connection = this.connection(prepared.layer, prepared.rpcUrl);
    // The ER does not run preflight; the base layer does.
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: prepared.layer === "er",
    });
    const result = await connection.confirmTransaction(
      {
        signature,
        blockhash: prepared.recentBlockhash,
        lastValidBlockHeight: prepared.lastValidBlockHeight,
      },
      "confirmed",
    );
    if (result.value.err) {
      throw new Error(`${prepared.description} failed: ${JSON.stringify(result.value.err)}`);
    }
    return signature;
  }

  createClaim(input: {
    question: string;
    creatorPosition: string;
    counterPosition: string;
    resolutionUrl: string;
    category?: string;
    stakeUsdc: number;
    deadline: number;
    maxChallengers?: number;
    delegate?: boolean;
  }) {
    return this.execute("createClaim", input);
  }

  /** Zero-fee inside the ER when the claim is delegated; call delegateBalance once first. */
  challenge(input: { claimId: number | string; stakeUsdc: number }) {
    return this.execute("challenge", input);
  }

  /** Dispute a PROPOSED verdict; posts the bond from the operator's USDC account. */
  dispute(claimId: number | string) {
    return this.execute("dispute", { claimId });
  }

  deposit(amountUsdc: number) {
    return this.execute("deposit", { amountUsdc });
  }

  delegateBalance() {
    return this.execute("delegateBalance", {});
  }

  undelegateBalance() {
    return this.execute("undelegateBalance", {});
  }

  withdraw(amountUsdc: number) {
    return this.execute("withdraw", { amountUsdc });
  }

  // ── Owner-gated ──────────────────────────────────────────────────────────

  /** Owner-signed. The returned key is shown once and cannot be read back. */
  issueKey(label = "default") {
    return this.call<{ key: string; prefix: string }>("issueKey", { label }, { owner: true });
  }

  listKeys() {
    return this.call("listKeys", {}, { owner: true });
  }

  revokeKey(prefix: string) {
    return this.call("revokeKey", { prefix }, { owner: true });
  }

  /** Owner-signed and terminal. Clears capabilities and every issued key. */
  revoke() {
    return this.call("revoke", {}, { owner: true });
  }

  /** Owner-signed; `operatorSignature` is the new operator's signature over `operatorProofMessage`. */
  rotateOperator(operatorWallet: string, operatorSignature: string) {
    return this.call("rotateOperator", { operatorWallet, operatorSignature }, { owner: true });
  }

  // ── Baskets: follow with the operator key, mirror through this API ──────

  /**
   * Follow (or re-cap, or with 0 unfollow) a basket as this agent's operator
   * wallet, which is the wallet that stakes the copies. Signed and
   * timestamped; nothing is deposited.
   */
  async followBasket(basketId: string, perMarketCapUsdc: number): Promise<Record<string, unknown>> {
    if (!this.operator) throw new Error("followBasket signs with the operator key, but no operator was set");
    const follower = this.operator.publicKey.toBase58();
    const signedAt = Date.now();
    const signature = signAgentMessage(
      followMessage({ basketId, follower, perMarketCapUsdc, signedAt }),
      this.operator.secretKey,
    );
    return this.basketRequest(`/api/baskets/${encodeURIComponent(basketId)}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ follower, perMarketCapUsdc, signature, signedAt }),
    });
  }

  /** Open member positions this operator has not copied yet, sized to its signed cap. */
  async basketSignals(basketId: string): Promise<{ following: boolean; perMarketCapUsdc: number; signals: MirrorSignal[] }> {
    const follower = this.operator?.publicKey.toBase58();
    const qs = follower ? `?follower=${encodeURIComponent(follower)}` : "";
    const res = await this.basketRequest(`/api/baskets/${encodeURIComponent(basketId)}/signals${qs}`);
    return res as unknown as { following: boolean; perMarketCapUsdc: number; signals: MirrorSignal[] };
  }

  /**
   * Copy every open signal with this agent's own `challenge` action, so the
   * agent's authority and USDC limits apply to each copy. One failure does not
   * stop the rest; each outcome is returned.
   */
  async mirrorBasket(basketId: string): Promise<Array<{ claimId: number; signatures?: string[]; error?: string }>> {
    const { following, signals } = await this.basketSignals(basketId);
    if (!following) throw new Error(`not following ${basketId}: call followBasket first`);
    const results: Array<{ claimId: number; signatures?: string[]; error?: string }> = [];
    for (const s of signals) {
      try {
        const { signatures } = await this.challenge({
          claimId: s.claimId,
          stakeUsdc: Number(BigInt(s.suggestedStakeUnits)) / 1_000_000,
        });
        results.push({ claimId: s.claimId, signatures });
      } catch (err) {
        results.push({ claimId: s.claimId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  private async basketRequest(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new MimirAgentApiError(
        String(parsed.message ?? `HTTP ${res.status}`),
        res.status,
        String(parsed.reason ?? "unknown"),
      );
    }
    return parsed;
  }

  private connection(layer: "base" | "er", fallback: string): Connection {
    const url = this.rpc[layer] ?? fallback;
    let c = this.connections.get(url);
    if (!c) {
      c = new Connection(url, "confirmed");
      this.connections.set(url, c);
    }
    return c;
  }
}

/** The message a new operator wallet signs to prove it controls itself. */
export { operatorProofMessage };

/**
 * Register a new agent. Separate from the client because there is no agent to
 * construct a client around yet, and because it needs two signatures: the
 * owner authorizes the record, the operator proves it holds its own key.
 */
export async function registerAgent(args: {
  baseUrl: string;
  agentId: string;
  ownerWallet: string;
  operatorWallet: string;
  payoutWallet?: string;
  displayName?: string;
  authorityLevel?: number;
  capabilities?: string[];
  signWithOwner: SignMessage;
  signWithOperator: SignMessage;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const operatorSignature = await args.signWithOperator(operatorProofMessage(args.agentId, args.operatorWallet));
  const envelope = newEnvelope(args.agentId, "register", {
    ownerWallet: args.ownerWallet,
    operatorWallet: args.operatorWallet,
    payoutWallet: args.payoutWallet ?? args.ownerWallet,
    displayName: args.displayName ?? args.agentId,
    authorityLevel: args.authorityLevel ?? 0,
    capabilities: args.capabilities ?? [],
    operatorSignature,
  });
  envelope.signature = await args.signWithOwner(agentRequestMessage(envelope));
  return postEnvelope(args.fetchImpl ?? fetch, args.baseUrl, envelope);
}
