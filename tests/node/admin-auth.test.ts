import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { ADMIN_TTL_MS, adminWallet, adminWallets, issueAdminNonce, startAdminSession } from "../../lib/server/admin";
import { useMemoryStore } from "../../lib/server/store";

useMemoryStore();

const sign = (kp: Keypair, message: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
const bearer = (token: string) => new Request("https://mimirmarkets.xyz/api/admin/overview", { headers: { authorization: `Bearer ${token}` } });

test("there is no built-in admin: only ADMIN_WALLETS", () => {
  assert.deepEqual([...adminWallets({})], []);
  assert.deepEqual([...adminWallets({ ADMIN_WALLETS: "a, b" })], ["a", "b"]);
});

test("a signed, fresh, same-domain challenge opens a 10-minute session", async () => {
  const admin = Keypair.generate();
  const w = admin.publicKey.toBase58();
  const env = { ADMIN_WALLETS: w };
  const now = 1_000_000;
  const c = await issueAdminNonce(w, "mimirmarkets.xyz", now, env);
  assert.ok(c);
  const s = await startAdminSession({ wallet: w, nonce: c.nonce, signature: sign(admin, c.message), origin: "https://mimirmarkets.xyz" }, now + 1000, env);
  assert.ok(s);
  assert.equal(await adminWallet(bearer(s.token), now + 2000, env), w);
  assert.equal(await adminWallet(bearer(s.token), now + 1000 + ADMIN_TTL_MS + 1, env), null, "the session expires");
  // Single use: the same signed challenge cannot open a second session.
  assert.equal(await startAdminSession({ wallet: w, nonce: c.nonce, signature: sign(admin, c.message), origin: "https://mimirmarkets.xyz" }, now + 3000, env), null);
});

test("strangers, other domains, stale challenges and wrong signatures get nothing", async () => {
  const admin = Keypair.generate();
  const w = admin.publicKey.toBase58();
  const env = { ADMIN_WALLETS: w };
  assert.equal(await issueAdminNonce(Keypair.generate().publicKey.toBase58(), "mimirmarkets.xyz", 0, env), null);

  const fresh = async () => (await issueAdminNonce(w, "mimirmarkets.xyz", 0, env))!;
  let c = await fresh();
  assert.equal(await startAdminSession({ wallet: w, nonce: c.nonce, signature: sign(admin, c.message), origin: "https://evil.example" }, 1, env), null, "other origin");
  c = await fresh();
  assert.equal(await startAdminSession({ wallet: w, nonce: c.nonce, signature: sign(admin, c.message), origin: "https://mimirmarkets.xyz" }, ADMIN_TTL_MS + 1, env), null, "stale");
  c = await fresh();
  assert.equal(await startAdminSession({ wallet: w, nonce: c.nonce, signature: sign(Keypair.generate(), c.message), origin: "https://mimirmarkets.xyz" }, 1, env), null, "wrong key");
  assert.equal(await adminWallet(bearer("f".repeat(48)), 1, env), null, "unknown token");
  assert.equal(await adminWallet(new Request("https://x"), 1, env), null, "no token");
});

test("the overview route answers 404 without a session", async () => {
  process.env.ADMIN_WALLETS = Keypair.generate().publicKey.toBase58();
  const { GET } = await import("../../app/api/admin/overview/route");
  for (const req of [new Request("http://x/api/admin/overview"), bearer("0".repeat(48))]) {
    const res = await GET(req);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not found" });
  }
});
