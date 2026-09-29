import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";

import { GET } from "../../app/api/token/tier/route";

const req = (qs: string) =>
  new Request(`http://localhost/api/token/tier?${qs}`, { headers: { "x-forwarded-for": "203.0.113.9" } });

test("the batch form rejects bad or too many wallets before any mainnet read", async () => {
  assert.equal((await GET(req("wallets="))).status, 400);
  assert.equal((await GET(req("wallets=not-a-key"))).status, 400);
  const many = Array.from({ length: 18 }, () => Keypair.generate().publicKey.toBase58()).join(",");
  const res = await GET(req(`wallets=${many}`));
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /1-17/);
});

test("the single form still validates its wallet", async () => {
  assert.equal((await GET(req("wallet=nope"))).status, 400);
});
