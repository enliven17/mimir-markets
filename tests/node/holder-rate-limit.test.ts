import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { provenTier } from "../../lib/server/holder";
import { resetMemoryRateLimits } from "../../lib/server/rate-limit";
import { formatProofHeader, holderProofMessage } from "../../lib/token-proof";

delete process.env.DATABASE_URL;

function provenRequest(ip: string): Request {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const signedAt = Date.now();
  const sig = nacl.sign.detached(new TextEncoder().encode(holderProofMessage(wallet, signedAt)), kp.secretKey);
  return new Request("http://x", {
    headers: {
      "x-real-ip": ip,
      "x-mimir-wallet": wallet,
      "x-mimir-proof": formatProofHeader(signedAt, bs58.encode(sig)),
    },
  });
}

test("holder proofs are IP rate-limited before any mainnet RPC call", async () => {
  resetMemoryRateLimits();
  process.env.HOLDER_PROOF_PER_MIN = "2";
  const realFetch = globalThis.fetch;
  let rpcCalls = 0;
  globalThis.fetch = (async () => {
    rpcCalls++;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: [] } }));
  }) as typeof fetch;
  try {
    await provenTier(provenRequest("198.51.100.7"));
    await provenTier(provenRequest("198.51.100.7"));
    const before = rpcCalls;
    assert.ok(before > 0, "proofs under the limit do read mainnet");
    assert.equal(await provenTier(provenRequest("198.51.100.7")), "none");
    assert.equal(rpcCalls, before, "an over-limit IP never reaches the RPC");
    // Another IP has its own budget.
    await provenTier(provenRequest("198.51.100.8"));
    assert.ok(rpcCalls > before);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.HOLDER_PROOF_PER_MIN;
  }
});

test("a wallet already read this minute does not use up the IP budget", async () => {
  resetMemoryRateLimits();
  process.env.HOLDER_PROOF_PER_MIN = "1";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: [] } }))) as typeof fetch;
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const signedAt = Date.now();
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(holderProofMessage(wallet, signedAt)), kp.secretKey));
    const again = () =>
      new Request("http://x", {
        headers: { "x-real-ip": "198.51.100.9", "x-mimir-wallet": wallet, "x-mimir-proof": formatProofHeader(signedAt, sig) },
      });
    await provenTier(again());
    await provenTier(again());
    await provenTier(again());
    // A new wallet from that IP is over the budget of 1.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: [] } }));
    }) as typeof fetch;
    await provenTier(provenRequest("198.51.100.9"));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.HOLDER_PROOF_PER_MIN;
  }
});
