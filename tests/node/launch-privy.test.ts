import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { agentWalletPolicy } from "../../lib/launch/solana/policy";
import { canonicalize, createPrivy, SOLANA_MAINNET_CAIP2 } from "../../lib/launch/solana/privy";
import { json, recordingFetch } from "../../lib/launch/solana/testkit";

const APP_ID = "cla06f34x0001mh08l8nsr496";
const SECRET = "super-secret-app-secret";
const WALLET_ID = "tb54eps4z44ed0jepousxi4n";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const AUTH_KEY = `wallet-auth:${privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")}`;
const SIG = "5".repeat(88);

function setup(reply = (url: string) => (url.endsWith("/rpc") ? json({ data: { hash: SIG, signed_transaction: "AQID" } }) : json({ id: "p".repeat(24), address: Keypair.generate().publicKey.toBase58() }))) {
  const rec = recordingFetch((c) => reply(c.url));
  let n = 0;
  const privy = createPrivy({ appId: APP_ID, appSecret: SECRET, authKey: AUTH_KEY, fetch: rec.fetch, now: () => 1_700_000_000_000, idempotencyKey: () => `key-${++n}` });
  return { privy, calls: rec.calls };
}
const headers = (init: RequestInit) => init.headers as Record<string, string>;

test("canonicalize sorts keys recursively (RFC 8785) and keeps arrays in order", () => {
  assert.equal(canonicalize({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } }), '{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}');
});

test("signAndSend: mainnet CAIP-2, base64 body, basic auth, app id, idempotency + expiry headers", async () => {
  const { privy, calls } = setup();
  assert.equal(await privy.signAndSend(WALLET_ID, "AQID"), SIG);
  const c = calls[0];
  assert.equal(c.url, `https://api.privy.io/v1/wallets/${WALLET_ID}/rpc`);
  assert.equal(c.init.method, "POST");
  assert.deepEqual(c.body, { method: "signAndSendTransaction", caip2: SOLANA_MAINNET_CAIP2, params: { transaction: "AQID", encoding: "base64" } });
  assert.equal(SOLANA_MAINNET_CAIP2, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  const h = headers(c.init);
  assert.equal(h.authorization, `Basic ${Buffer.from(`${APP_ID}:${SECRET}`).toString("base64")}`);
  assert.equal(h["privy-app-id"], APP_ID);
  assert.equal(h["privy-idempotency-key"], "key-1");
  assert.equal(h["privy-request-expiry"], String(1_700_000_000_000 + 60_000));
});

test("authorization signature: DER ECDSA P-256 over canonical {version,method,url,body,privy-* headers}", async () => {
  const { privy, calls } = setup();
  await privy.signTransaction(WALLET_ID, "AQID");
  const c = calls[0];
  const h = headers(c.init);
  const payload = canonicalize({
    version: 1,
    method: "POST",
    url: c.url,
    body: c.body as never,
    headers: { "privy-app-id": APP_ID, "privy-idempotency-key": h["privy-idempotency-key"], "privy-request-expiry": h["privy-request-expiry"] },
  });
  const sig = Buffer.from(h["privy-authorization-signature"], "base64");
  assert.equal(sig[0], 0x30, "DER SEQUENCE, not raw r||s");
  assert.ok(verify("sha256", Buffer.from(payload), createPublicKey(privateKey), sig));
  assert.deepEqual(c.body, { method: "signTransaction", params: { transaction: "AQID", encoding: "base64" } });
});

test("createWalletWithPolicy: wallet (owned by auth key) -> policy for its address -> PATCH attach", async () => {
  const { privy, calls } = setup((url) => (url.endsWith("/v1/policies") ? json({ id: "q".repeat(24) }) : json({ id: WALLET_ID, address: "DoyrVvzR2vwurz23Kkk5Z4QVeXLjs6nUfsSsnghidS8" })));
  const treasury = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const out = await privy.createWalletWithPolicy((address) => agentWalletPolicy({ wallet: address, creator, treasury }));
  assert.deepEqual(out, { id: WALLET_ID, address: "DoyrVvzR2vwurz23Kkk5Z4QVeXLjs6nUfsSsnghidS8", policyId: "q".repeat(24) });
  assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url}`), [
    "POST https://api.privy.io/v1/wallets",
    "POST https://api.privy.io/v1/policies",
    `PATCH https://api.privy.io/v1/wallets/${WALLET_ID}`,
  ]);
  const owner = { public_key: privy.ownerPublicKey };
  assert.deepEqual(calls[0].body, { chain_type: "solana", owner });
  assert.deepEqual((calls[1].body as { owner: unknown }).owner, owner);
  assert.equal((calls[1].body as { chain_type: string }).chain_type, "solana");
  assert.deepEqual(calls[2].body, { policy_ids: ["q".repeat(24)] });
  assert.ok(headers(calls[2].init)["privy-authorization-signature"]);
  assert.equal(new Set(calls.map((c) => headers(c.init)["privy-idempotency-key"])).size, 3, "fresh idempotency key per request");
});

test("createWalletWithPolicy failure names the unfunded wallet", async () => {
  const { privy } = setup((url) => (url.endsWith("/v1/policies") ? json({ error: "bad" }, 400) : json({ id: WALLET_ID, address: Keypair.generate().publicKey.toBase58() })));
  await assert.rejects(privy.createWalletWithPolicy(() => agentWalletPolicy({ wallet: Keypair.generate().publicKey.toBase58(), creator: Keypair.generate().publicKey.toBase58(), treasury: Keypair.generate().publicKey.toBase58() })), /tb54eps4z44ed0jepousxi4n created but policy not attached; do NOT fund it/);
});

test("errors carry provider + status + code and never leak the secret", async () => {
  const { privy } = setup(() => json({ error: `policy violation ${SECRET}`, code: "POLICY_VIOLATION" }, 403));
  await assert.rejects(privy.signTransaction(WALLET_ID, "AQID"), (err: Error & { status: number; code: string; provider: string }) => {
    assert.equal(err.provider, "privy");
    assert.equal(err.status, 403);
    assert.equal(err.code, "POLICY_VIOLATION");
    assert.match(err.message, /^privy: POST \/v1\/wallets\/.+\/rpc -> 403/);
    assert.ok(!err.message.includes(SECRET));
    return true;
  });
});

test("input validation and config errors", async () => {
  const { privy } = setup();
  await assert.rejects(privy.signTransaction("../admin", "AQID"), /walletId is malformed/);
  await assert.rejects(privy.signTransaction(WALLET_ID, "not base64!"), /must be base64/);
  assert.throws(() => createPrivy({ appId: APP_ID, appSecret: "" }), /PRIVY_APP_SECRET/);
  assert.throws(() => createPrivy({ appId: APP_ID, appSecret: SECRET, authKey: "wallet-auth:Zm9v" }), /not a valid P-256/);
  const noAuth = createPrivy({ appId: APP_ID, appSecret: SECRET, fetch: recordingFetch(() => json({ id: WALLET_ID, address: Keypair.generate().publicKey.toBase58() })).fetch });
  assert.equal(noAuth.ownerPublicKey, null);
});
