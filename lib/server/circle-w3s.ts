/**
 * Circle developer-controlled wallets (W3S) for the house agents on Arc: the
 * council personas sign through Circle's API, so no agent key lives on our
 * servers. Ported from the old mimir repo (lib/circle-w3s.ts).
 *
 *   CIRCLE_API_KEY        bearer
 *   CIRCLE_ENTITY_SECRET  hex; encrypted per request with Circle's RSA key
 *   CIRCLE_WALLET_SET_ID  where new wallets go
 *
 * A contract write: POST contractExecution → poll the transaction until it is
 * confirmed (or failed) → the tx hash. Reads stay on the Arc RPC.
 */
import { constants, createPublicKey, publicEncrypt, randomUUID } from "node:crypto";
import type { Hex } from "viem";

const CIRCLE_BASE = "https://api.circle.com/v1/w3s";
const TIMEOUT_MS = 20_000;
const TERMINAL_OK = new Set(["COMPLETE", "CONFIRMED"]);
const TERMINAL_BAD = new Set(["FAILED", "CANCELLED", "DENIED"]);

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let publicKey: { pem: string; at: number } | null = null;

async function circleFetch<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CIRCLE_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env("CIRCLE_API_KEY")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Circle ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function entitySecretCiphertext(): Promise<string> {
  if (!publicKey || Date.now() - publicKey.at > 5 * 60_000) {
    const r = await circleFetch<{ data: { publicKey: string } }>("GET", "/config/entity/publicKey");
    publicKey = { pem: r.data.publicKey, at: Date.now() };
  }
  const cipher = publicEncrypt(
    { key: createPublicKey({ key: publicKey.pem, format: "pem" }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(env("CIRCLE_ENTITY_SECRET"), "hex"),
  );
  return cipher.toString("base64");
}

async function waitForTxHash(id: string, timeoutMs = 90_000): Promise<Hex> {
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < timeoutMs) {
    const t = (await circleFetch<{ data: { transaction: { state: string; txHash?: string; errorReason?: string } } }>("GET", `/transactions/${id}`)).data.transaction;
    if (TERMINAL_OK.has(t.state) && t.txHash) return t.txHash as Hex;
    if (TERMINAL_BAD.has(t.state)) throw new Error(`Circle tx ${id} ${t.state}: ${t.errorReason ?? "unknown"}`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 500, 5000);
  }
  throw new Error(`Circle tx ${id} did not confirm within ${timeoutMs} ms`);
}

export interface ContractCall {
  walletId: string;
  contractAddress: `0x${string}`;
  /** e.g. "stake(uint256,uint8,address)" */
  abiFunctionSignature: string;
  /** Plain values; bigints are sent as decimal strings. */
  abiParameters: unknown[];
  /** Native USDC to attach (msg.value) as a decimal string in USDC, e.g. "2.5"; not wei. */
  amount?: string;
}

/** One contract write from a Circle wallet, waited until confirmed. Returns the tx hash. */
export async function executeContract(c: ContractCall): Promise<Hex> {
  const body: Record<string, unknown> = {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: await entitySecretCiphertext(),
    walletId: c.walletId,
    contractAddress: c.contractAddress,
    abiFunctionSignature: c.abiFunctionSignature,
    abiParameters: c.abiParameters.map((p) => (typeof p === "bigint" ? p.toString() : p)),
    feeLevel: "MEDIUM",
  };
  if (c.amount) body.amount = c.amount;
  const r = await circleFetch<{ data: { id: string } }>("POST", "/developer/transactions/contractExecution", body);
  return waitForTxHash(r.data.id);
}

/** Native USDC from a Circle wallet to any address (funding personas). */
export async function transferNative(args: { walletId: string; to: `0x${string}`; amount: string; blockchain: string }): Promise<Hex> {
  const r = await circleFetch<{ data: { id: string } }>("POST", "/developer/transactions/transfer", {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: await entitySecretCiphertext(),
    walletId: args.walletId,
    destinationAddress: args.to,
    amounts: [args.amount],
    tokenAddress: "",
    blockchain: args.blockchain,
    feeLevel: "MEDIUM",
  });
  return waitForTxHash(r.data.id);
}

/** New EOA wallets in the wallet set, one per name. */
export async function createWallets(names: string[], blockchain: string): Promise<Array<{ id: string; address: `0x${string}`; refId: string }>> {
  const r = await circleFetch<{ data: { wallets: Array<{ id: string; address: string; refId?: string }> } }>("POST", "/developer/wallets", {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: await entitySecretCiphertext(),
    walletSetId: env("CIRCLE_WALLET_SET_ID"),
    blockchains: [blockchain],
    accountType: "EOA",
    count: names.length,
    metadata: names.map((n) => ({ name: `mimir-council-${n}`, refId: n })),
  });
  return r.data.wallets.map((w) => ({ id: w.id, address: w.address as `0x${string}`, refId: w.refId ?? "" }));
}

/** Persona slug → its Arc wallet, from ARC_COUNCIL_WALLETS (JSON). */
export type CouncilWallets = Record<string, { id: string; address: `0x${string}` }>;

export function councilWalletsFromEnv(): CouncilWallets {
  try {
    return JSON.parse(process.env.ARC_COUNCIL_WALLETS ?? "{}") as CouncilWallets;
  } catch {
    return {};
  }
}
