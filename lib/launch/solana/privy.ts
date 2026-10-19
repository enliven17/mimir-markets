// Privy server wallets over REST. Deliberately no `import "server-only"` (runs in the worker and
// under node --test). Secrets never appear in errors or logs.
//
// Docs (verified 2026-10-05):
//   https://docs.privy.io/api-reference/introduction.md       Basic auth (appId:appSecret) + privy-app-id header
//   https://docs.privy.io/api-reference/wallets/create.md     POST /v1/wallets {chain_type, policy_ids (max 1), owner}
//   https://docs.privy.io/api-reference/wallets/update.md     PATCH /v1/wallets/{id} {policy_ids}
//   https://docs.privy.io/api-reference/policies/create.md    POST /v1/policies {version, name, chain_type, rules, owner}
//   https://docs.privy.io/api-reference/wallets/solana/sign-and-send-transaction.md
//       POST /v1/wallets/{id}/rpc {method:"signAndSendTransaction", caip2, params:{transaction, encoding:"base64"}}
//       -> data.hash. Synchronous broadcast; does NOT wait for confirmation.
//   https://docs.privy.io/api-reference/wallets/solana/sign-transaction.md
//       POST /v1/wallets/{id}/rpc {method:"signTransaction", params:{transaction, encoding}} -> data.signed_transaction
//   https://docs.privy.io/api-reference/idempotency-keys.md   privy-idempotency-key; on /rpc a 5xx is CACHED for
//       the key's 24h lifetime, so a retry needs a fresh key.
//   https://docs.privy.io/controls/authorization-keys/using-owners/sign/direct-implementation.md
//       privy-authorization-signature = base64(DER ECDSA P-256/SHA-256 over RFC 8785 JSON of
//       {version:1, method, url, body, headers:{privy-* headers}}); key is "wallet-auth:" + base64 PKCS#8.
//       Required whenever the wallet/policy has an owner. We make the authorization key the owner of
//       every wallet and policy we create, so the app secret alone cannot sign or change policies.
//   https://docs.privy.io/api-reference/wallets/ethereum/eth-sign-transaction.md
//       POST /v1/wallets/{id}/rpc {method:"eth_signTransaction", params:{transaction:{to,value,data,chain_id,nonce,...}}}
//       -> data.signed_transaction (RLP hex). Used for Robinhood Chain wallets (chain_type "ethereum"); we broadcast.
//   NOTE: Privy's own examples produce DER signatures (node crypto.sign, Go SignASN1, Rust to_der);
//       WebCrypto would produce raw r||s, so node:crypto is used on purpose.
import { createPrivateKey, createPublicKey, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { isAddress } from "viem";
import { z } from "zod";
import { assertAddress, errorBody, fetchWithTimeout, SolanaError, type FetchLike } from "./util";
import type { PolicyInput } from "./policy";
import type { EvmPolicyInput } from "../robinhood/policy";

export type ChainType = "solana" | "ethereum";
/** An EIP-1559 transaction as Privy takes it: quantities as hex strings. */
export type EvmTx = { to: string; value: string; data: string; chain_id: number; nonce: number; gas_limit: string; max_fee_per_gas: string; max_priority_fee_per_gas: string; type: 2 };

export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BASE_URL = "https://api.privy.io";
const DEFAULT_TIMEOUT_MS = 20_000;
const REQUEST_TTL_MS = 60_000;

export type PrivyOptions = {
  appId: string;
  appSecret: string;
  /** "wallet-auth:<base64 PKCS#8>" from the Privy dashboard. Strongly recommended in production. */
  authKey?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
  idempotencyKey?: () => string;
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** RFC 8785 for the JSON we send (strings, booleans, safe integers, arrays, objects). */
export function canonicalize(v: Json): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
}

export function parseAuthKey(authKey: string): { privateKey: KeyObject; publicKeyB64: string } {
  try {
    const der = Buffer.from(authKey.replace(/^wallet-auth:/, ""), "base64");
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ec") throw new Error("not an EC key");
    const publicKeyB64 = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
    return { privateKey, publicKeyB64 };
  } catch {
    throw new SolanaError("privy", "PRIVY_AUTHORIZATION_KEY is not a valid P-256 PKCS#8 key", { code: "CONFIG" });
  }
}

export function authorizationSignature(privateKey: KeyObject, p: { method: string; url: string; body: Json; headers: Record<string, string> }): string {
  const payload = canonicalize({ version: 1, method: p.method, url: p.url, body: p.body, headers: p.headers });
  return cryptoSign("sha256", Buffer.from(payload), privateKey).toString("base64"); // DER by default
}

const WalletSchema = z.object({ id: z.string().min(1), address: z.string() });
const PolicySchema = z.object({ id: z.string().min(1) });
const SendSchema = z.object({ data: z.object({ hash: z.string().min(64) }) });
const SignSchema = z.object({ data: z.object({ signed_transaction: z.string().min(1) }) });

export function createPrivy(o: PrivyOptions) {
  if (!o.appId || !o.appSecret) throw new SolanaError("privy", "PRIVY_APP_ID and PRIVY_APP_SECRET are required", { code: "CONFIG" });
  const doFetch = o.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = o.now ?? Date.now;
  const newKey = o.idempotencyKey ?? randomUUID;
  const auth = o.authKey ? parseAuthKey(o.authKey) : null;
  const basic = `Basic ${Buffer.from(`${o.appId}:${o.appSecret}`).toString("base64")}`;
  const owner: Record<string, Json> = auth ? { owner: { public_key: auth.publicKeyB64 } } : {};

  async function call<T>(method: "POST" | "PATCH" | "GET", path: string, body: Json, schema: z.ZodType<T>): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const privy: Record<string, string> = { "privy-app-id": o.appId, "privy-idempotency-key": newKey(), "privy-request-expiry": String(now() + REQUEST_TTL_MS) };
    const headers: Record<string, string> = { ...privy, authorization: basic, "content-type": "application/json" };
    if (auth && method !== "GET") headers["privy-authorization-signature"] = authorizationSignature(auth.privateKey, { method, url, body, headers: privy });
    const res = await fetchWithTimeout(doFetch, "privy", url, { method, headers, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }, timeoutMs);
    if (!res.ok) {
      const text = await errorBody(res, [o.appSecret, o.authKey]);
      const code = /"code"\s*:\s*"([A-Za-z_]+)"/.exec(text)?.[1] ?? null;
      throw new SolanaError("privy", `${method} ${path} -> ${res.status}: ${text || res.statusText}`, { status: res.status, code });
    }
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new SolanaError("privy", `${method} ${path} returned an unexpected body`, { status: res.status });
    return parsed.data;
  }

  const rpc = (walletId: string, body: Json) => call("POST", `/v1/wallets/${encodeURIComponent(walletId)}/rpc`, body, z.unknown());
  const checkWalletId = (id: string) => {
    if (!/^[a-z0-9]{10,64}$/.test(id)) throw new SolanaError("privy", "walletId is malformed", { code: "BAD_INPUT" });
  };
  const checkTx = (tx: string) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(tx)) throw new SolanaError("privy", "transaction must be base64", { code: "BAD_INPUT" });
  };

  async function createWallet(policyIds?: string[], chainType: ChainType = "solana"): Promise<{ id: string; address: string }> {
    const w = await call("POST", "/v1/wallets", { chain_type: chainType, ...(policyIds?.length ? { policy_ids: policyIds } : {}), ...owner }, WalletSchema);
    if (chainType === "ethereum") {
      if (!isAddress(w.address)) throw new SolanaError("privy", "privy wallet address is not an EVM address");
      return { id: w.id, address: w.address };
    }
    return { id: w.id, address: assertAddress("privy wallet address", w.address) };
  }
  const createPolicy = (policy: PolicyInput | EvmPolicyInput): Promise<{ id: string }> =>
    call("POST", "/v1/policies", { ...(policy as unknown as Record<string, Json>), ...owner }, PolicySchema);
  async function setWalletPolicies(walletId: string, policyIds: string[]): Promise<void> {
    checkWalletId(walletId);
    await call("PATCH", `/v1/wallets/${encodeURIComponent(walletId)}`, { policy_ids: policyIds }, z.unknown());
  }

  const PolicyIdsSchema = z.object({ policy_ids: z.array(z.string()).default([]) });

  /** Policy ids attached to a wallet (GET /v1/wallets/{id}). */
  async function walletPolicyIds(walletId: string): Promise<string[]> {
    checkWalletId(walletId);
    return (await call("GET", `/v1/wallets/${encodeURIComponent(walletId)}`, null, PolicyIdsSchema)).policy_ids ?? [];
  }

  /** Replaces a policy's name and rules (PATCH /v1/policies/{id}); signed by the owner key. */
  async function updatePolicy(policyId: string, policy: PolicyInput): Promise<void> {
    if (!/^[a-z0-9]{8,64}$/.test(policyId)) throw new SolanaError("privy", "policyId is malformed", { code: "BAD_INPUT" });
    await call("PATCH", `/v1/policies/${encodeURIComponent(policyId)}`, { name: policy.name, rules: policy.rules as unknown as Json }, z.unknown());
  }

  return {
    ownerPublicKey: auth?.publicKeyB64 ?? null,
    walletPolicyIds,
    updatePolicy,
    createWallet,
    createPolicy,
    setWalletPolicies,

    /** Privy signs AND broadcasts. Prefer signTransaction + our own broadcast (see executor) for safe retries. */
    async signAndSend(walletId: string, txBase64: string): Promise<string> {
      checkWalletId(walletId);
      checkTx(txBase64);
      const body = { method: "signAndSendTransaction", caip2: SOLANA_MAINNET_CAIP2, params: { transaction: txBase64, encoding: "base64" } };
      const out = SendSchema.safeParse(await rpc(walletId, body));
      if (!out.success) throw new SolanaError("privy", "signAndSendTransaction returned no hash");
      return out.data.data.hash;
    },

    /** Signs an EVM transaction (Robinhood Chain); the caller broadcasts it. Returns the RLP-encoded signed tx. */
    async signEvmTransaction(walletId: string, transaction: EvmTx): Promise<`0x${string}`> {
      checkWalletId(walletId);
      const out = SignSchema.safeParse(await rpc(walletId, { method: "eth_signTransaction", params: { transaction } }));
      if (!out.success || !/^0x[0-9a-fA-F]+$/.test(out.data.data.signed_transaction)) throw new SolanaError("privy", "eth_signTransaction returned no signed_transaction");
      return out.data.data.signed_transaction as `0x${string}`;
    },

    async signTransaction(walletId: string, txBase64: string): Promise<string> {
      checkWalletId(walletId);
      checkTx(txBase64);
      const out = SignSchema.safeParse(await rpc(walletId, { method: "signTransaction", params: { transaction: txBase64, encoding: "base64" } }));
      if (!out.success) throw new SolanaError("privy", "signTransaction returned no signed_transaction");
      return out.data.data.signed_transaction;
    },

    /** Create wallet -> policy (needs the address for its WSOL account) -> attach. Throws with walletId if the policy step fails. */
    async createWalletWithPolicy(buildPolicy: (address: string) => PolicyInput | EvmPolicyInput, chainType: ChainType = "solana"): Promise<{ id: string; address: string; policyId: string }> {
      const wallet = await createWallet(undefined, chainType);
      try {
        const { id: policyId } = await createPolicy(buildPolicy(wallet.address));
        await setWalletPolicies(wallet.id, [policyId]);
        return { ...wallet, policyId };
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        throw new SolanaError("privy", `wallet ${wallet.id} created but policy not attached; do NOT fund it: ${why}`, { code: "POLICY_NOT_ATTACHED" });
      }
    },
  };
}

export type Privy = ReturnType<typeof createPrivy>;
