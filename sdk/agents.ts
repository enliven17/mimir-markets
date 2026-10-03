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
import { Connection, PublicKey, Transaction, type Keypair } from "@solana/web3.js";

import {
  agentRequestMessage,
  operatorProofMessage,
  type AgentAction,
  type AgentEnvelope,
  type AgentWriteAction,
} from "../lib/agents/api";
import { signAgentMessage } from "../lib/agents/signature";
import { followMessage, type MirrorSignal } from "../lib/baskets";
import { copyPermissionMessage, followerProofMessage } from "../lib/copy-trading";
import type { CopyDraft } from "../lib/copy-form";
import { MAGICBLOCK_ER_RPC, MIMIR_PROGRAM_ID, SOLANA_RPC, USDC_MINT } from "../lib/solana/config";
import { verifyPreparedTransaction, type TxExpectation } from "./verify-tx";

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
  /**
   * RPC per layer. Defaults to this process's config (NEXT_PUBLIC_SOLANA_RPC,
   * NEXT_PUBLIC_MAGICBLOCK_ER_RPC); the rpcUrl the API returns is never used.
   */
  rpc?: { base?: string; er?: string };
  /** The Mimir program transactions may call. Defaults to NEXT_PUBLIC_MIMIR_PROGRAM_ID, never the server's word. */
  programId?: PublicKey | string;
  /** USDC mint for the withdraw destination check. Defaults to the configured mint. */
  usdcMint?: PublicKey | string;
  /** Highest priority fee a prepared transaction may set (micro-lamports per CU). */
  maxPriorityMicroLamports?: number;
  /**
   * The agent's registered payout wallet, when it earns the agent fee
   * (fee_earner). Prepared transactions may name only it (or the operator,
   * or nobody) as the position's agent. Unset: read once from the API
   * (listEarnings); pin it here so a compromised server cannot redirect fees.
   */
  agentPayout?: PublicKey | string;
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

export interface CopySignalsResponse {
  ok: true;
  executionAgentId: string;
  signer: string;
  permissions: number;
  copy: Array<{
    permissionId: string;
    claimId: number;
    signalAgentId: string;
    question: string;
    category: string;
    layer: "base" | "er";
    stakeUsdc: number;
    stakeUnits: string;
  }>;
  skipped: Array<{ permissionId: string; claimId: number; reason: string; message: string }>;
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
  path = `/api/agents/v1/${envelope.action}`,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await doFetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
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
  private readonly programId: PublicKey;
  private readonly usdcMint: PublicKey;
  private readonly maxPriorityMicroLamports?: number;
  private agentPayout?: PublicKey;
  private readonly fetchImpl: typeof fetch;
  private readonly connections = new Map<string, Connection>();

  constructor(options: MimirAgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.agentId = options.agentId;
    this.apiKey = options.apiKey;
    this.operator = options.operator;
    this.signWithOwner = options.signWithOwner;
    this.rpc = options.rpc ?? {};
    this.programId = new PublicKey(options.programId ?? MIMIR_PROGRAM_ID);
    this.usdcMint = new PublicKey(options.usdcMint ?? USDC_MINT);
    this.maxPriorityMicroLamports = options.maxPriorityMicroLamports;
    this.agentPayout = options.agentPayout ? new PublicKey(options.agentPayout) : undefined;
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
    { owner = false, path }: { owner?: boolean; path?: string } = {},
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
    return (await postEnvelope(this.fetchImpl, this.baseUrl, envelope, owner ? undefined : this.apiKey, path)) as T;
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
    const expect = expectationFor(action, body);
    const signatures: string[] = [];
    for (const prepared of response.transactions) {
      signatures.push(await this.submit(prepared, expect));
    }
    return { response, signatures };
  }

  /**
   * Verify one prepared transaction (sdk/verify-tx.ts), sign it with the
   * operator key and confirm it on its layer over this client's own RPC.
   * `expect` names the requested action (and amount / claim), so a
   * server-substituted instruction is refused before anything is signed.
   */
  async submit(prepared: PreparedTransaction, expect?: TxExpectation): Promise<string> {
    if (!this.operator) throw new Error("no operator keypair to sign with");
    if (prepared.layer !== "base" && prepared.layer !== "er") throw new Error("refusing to sign: unknown layer");
    const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    if (!this.agentPayout) {
      const earnings = (await this.listEarnings().catch(() => null)) as { payoutWallet?: string } | null;
      if (earnings?.payoutWallet) this.agentPayout = new PublicKey(earnings.payoutWallet);
    }
    verifyPreparedTransaction(tx, {
      programId: this.programId,
      operator: this.operator.publicKey,
      usdcMint: this.usdcMint,
      maxPriorityMicroLamports: this.maxPriorityMicroLamports,
      expect: { ...expect, agentPayout: this.agentPayout },
    });
    tx.partialSign(this.operator);
    const connection = this.connection(prepared.layer);
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

  /**
   * Owner-signed: answer Mimir Terminal users from your own endpoint. `url` ""
   * turns chat off; `priceUsdc` 0 is free, else 0.001 to 1 per message (99.5%
   * to your payout wallet). The response's `secret` (shown once, when the URL
   * changes) verifies each request: see verifyMimirRequest.
   */
  setChat(chat: { url: string; priceUsdc?: number; bio?: string }) {
    return this.call("setChat", { url: chat.url, priceUsdc: chat.priceUsdc ?? 0, bio: chat.bio ?? "" }, { owner: true });
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

  // ── Copy trading: execute a follower's signed permissions ────────────────

  /**
   * What this agent may copy right now under the permissions naming it as the
   * executor: `copy[]` sized to the follower's caps, `skipped[]` with reasons.
   */
  copySignals() {
    return this.call<CopySignalsResponse>("heartbeat", {}, { path: "/api/copy/signals" });
  }

  /** Re-gate one copy and get its unsigned challenge transaction(s). */
  prepareCopy(permissionId: string, claimId: number) {
    return this.call<WriteResponse & { stakeUsdc: number; stakeUnits: string }>(
      "heartbeat",
      { prepare: { permissionId, claimId } },
      { path: "/api/copy/signals" },
    );
  }

  /** Record a copy's outcome; an executed one is checked against the claim on chain. */
  reportCopy(report: {
    permissionId: string;
    claimId: number;
    executed: boolean;
    signature?: string;
    skipReason?: string;
  }) {
    return this.call("heartbeat", { report }, { path: "/api/copy/signals" });
  }

  /**
   * Place every allowed copy: prepare, sign with the operator key, submit,
   * report. One failure does not stop the rest; each outcome is returned.
   */
  async copyAll(): Promise<Array<{ permissionId: string; claimId: number; signatures?: string[]; error?: string }>> {
    if (!this.operator) throw new Error("copyAll signs transactions, but no operator was set");
    const { copy } = await this.copySignals();
    const results: Array<{ permissionId: string; claimId: number; signatures?: string[]; error?: string }> = [];
    for (const c of copy) {
      try {
        const prepared = await this.prepareCopy(c.permissionId, c.claimId);
        const expect: TxExpectation = { action: "challenge", claimId: BigInt(c.claimId) };
        const signatures: string[] = [];
        for (const tx of prepared.transactions) signatures.push(await this.submit(tx, expect));
        await this.reportCopy({
          permissionId: c.permissionId,
          claimId: c.claimId,
          executed: true,
          signature: signatures[signatures.length - 1],
        });
        results.push({ permissionId: c.permissionId, claimId: c.claimId, signatures });
      } catch (err) {
        results.push({
          permissionId: c.permissionId,
          claimId: c.claimId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  /**
   * Grant a copy permission as the operator wallet (a self-operated agent is
   * its own follower). `draft.follower` is overwritten with the operator key.
   */
  async grantCopyPermission(draft: Omit<CopyDraft, "follower" | "signedAt" | "active">): Promise<Record<string, unknown>> {
    if (!this.operator) throw new Error("grantCopyPermission signs with the operator key, but no operator was set");
    const signed: CopyDraft = {
      ...draft,
      follower: this.operator.publicKey.toBase58(),
      active: true,
      signedAt: Date.now(),
    };
    const signature = signAgentMessage(copyPermissionMessage(signed), this.operator.secretKey);
    return this.basketRequest("/api/copy/permissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...signed, signature }),
    });
  }

  /** The operator wallet's own permissions, with their recent copy audit. */
  listCopyPermissions(): Promise<Record<string, unknown>> {
    return this.basketRequest(`/api/copy/permissions?${this.followerProof("list")}`);
  }

  revokeCopyPermission(id: string): Promise<Record<string, unknown>> {
    return this.basketRequest(`/api/copy/permissions?${this.followerProof("revoke", id)}`, { method: "DELETE" });
  }

  private followerProof(action: "list" | "revoke", id = ""): string {
    if (!this.operator) throw new Error("follower proofs sign with the operator key, but no operator was set");
    const follower = this.operator.publicKey.toBase58();
    const at = Date.now();
    const signature = signAgentMessage(followerProofMessage(action, follower, at, id), this.operator.secretKey);
    return new URLSearchParams({ ...(id ? { id } : {}), follower, at: String(at), signature }).toString();
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

  private connection(layer: "base" | "er"): Connection {
    const url = this.rpc[layer] ?? (layer === "er" ? MAGICBLOCK_ER_RPC : SOLANA_RPC);
    let c = this.connections.get(url);
    if (!c) {
      c = new Connection(url, "confirmed");
      this.connections.set(url, c);
    }
    return c;
  }
}

/** USDC (number) to base units the way the API parses it; undefined when not a plain amount. */
function unitsOf(value: unknown): bigint | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? BigInt(Math.round(value * 1e6)) : undefined;
}

function claimIdOf(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  if (typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)) return BigInt(value);
  return undefined;
}

/** What the transactions for `action` with this request body must contain. */
export function expectationFor(action: AgentWriteAction, body: Record<string, unknown>): TxExpectation {
  const amount =
    action === "challenge" || action === "createClaim"
      ? unitsOf(body.stakeUsdc)
      : action === "deposit" || action === "withdraw"
        ? unitsOf(body.amountUsdc)
        : undefined;
  return { action, claimId: claimIdOf(body.claimId), amountUnits: amount };
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

/**
 * On your chat endpoint: is this Mimir Terminal request genuine and fresh?
 * Pass the raw request body (before JSON parsing), the `x-mimir-timestamp`
 * and `x-mimir-signature` headers, and the secret setChat returned.
 *
 *   if (!verifyMimirRequest({ secret, timestamp: req.headers["x-mimir-timestamp"],
 *        signature: req.headers["x-mimir-signature"], rawBody })) return res.status(401).end();
 *   res.json({ reply: await myModel(JSON.parse(rawBody).message) });
 */
export { verifyRelaySignature as verifyMimirRequest } from "../lib/terminal/relay";
export type { RelayPayload as MimirChatRequest } from "../lib/terminal/relay";
