import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { adminWallet, adminWallets } from "../../lib/server/admin";
import { formatProofHeader, holderProofMessage } from "../../lib/token-proof";

delete process.env.DATABASE_URL;

function signed(kp: Keypair, opts: { signedAt?: number; tamper?: boolean } = {}): Request {
  const wallet = kp.publicKey.toBase58();
  const signedAt = opts.signedAt ?? Date.now();
  const sig = nacl.sign.detached(new TextEncoder().encode(holderProofMessage(wallet, opts.tamper ? signedAt + 1 : signedAt)), kp.secretKey);
  return new Request("http://x/api/admin/overview", { headers: { "x-mimir-wallet": wallet, "x-mimir-proof": formatProofHeader(signedAt, bs58.encode(sig)) } });
}

test("the admin list defaults to the owner's wallet and reads ADMIN_WALLETS", () => {
  assert.deepEqual([...adminWallets({})], ["5JZp9pA33eoUREpQS6ui6AFVdaQ147aBrjh79w252gRQ"]);
  assert.deepEqual([...adminWallets({ ADMIN_WALLETS: "a, b" })], ["a", "b"]);
});

test("only a listed wallet with a valid proof is an admin", () => {
  const admin = Keypair.generate();
  const other = Keypair.generate();
  const env = { ADMIN_WALLETS: admin.publicKey.toBase58() };
  assert.equal(adminWallet(signed(admin), env), admin.publicKey.toBase58());
  assert.equal(adminWallet(signed(other), env), null, "a signed-in stranger");
  assert.equal(adminWallet(signed(admin, { tamper: true }), env), null, "a signature over another message");
  assert.equal(adminWallet(signed(admin, { signedAt: Date.now() - 2 * 86_400_000 }), env), null, "an expired proof");
  assert.equal(adminWallet(new Request("http://x", { headers: { "x-mimir-wallet": admin.publicKey.toBase58() } }), env), null, "no proof");
});

test("the overview route answers 404 to anyone who is not an admin", async () => {
  process.env.ADMIN_WALLETS = Keypair.generate().publicKey.toBase58();
  const { GET } = await import("../../app/api/admin/overview/route");
  for (const req of [new Request("http://x/api/admin/overview"), signed(Keypair.generate())]) {
    const res = await GET(req);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not found" });
  }
});
