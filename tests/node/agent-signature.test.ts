import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { agentRequestMessage, operatorProofMessage, type AgentEnvelope } from "../../lib/agents/api";
import {
  normalizeAddress,
  signAgentMessage,
  verifyAgentSignature,
} from "../../lib/agents/signature";
import { parseWriteParams, stakeOf, usdcToUnits } from "../../lib/agents/params";
import { AgentEnvelopeError } from "../../lib/agents/api";

const NOW_SEC = 1_700_000_000;

function envelope(over: Partial<AgentEnvelope> = {}): AgentEnvelope {
  return {
    version: "v1",
    agentId: "my-agent",
    action: "heartbeat",
    nonce: "n-1",
    signedAt: 1_700_000_000_000,
    body: { status: "ok" },
    ...over,
  };
}

test("an ed25519 signature over the envelope message round-trips", () => {
  const kp = Keypair.generate();
  const message = agentRequestMessage(envelope());
  const signature = signAgentMessage(message, kp.secretKey);
  assert.equal(bs58.decode(signature).length, 64);
  assert.equal(verifyAgentSignature({ address: kp.publicKey.toBase58(), message, signature }), true);
});

test("a wallet-adapter style signature (raw nacl bytes, base58) verifies the same way", () => {
  const kp = Keypair.generate();
  const message = operatorProofMessage("my-agent", kp.publicKey.toBase58());
  const raw = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  assert.equal(
    verifyAgentSignature({ address: kp.publicKey.toBase58(), message, signature: bs58.encode(raw) }),
    true,
  );
});

test("a signature does not verify for another key, another message or a tampered body", () => {
  const kp = Keypair.generate();
  const other = Keypair.generate();
  const env = envelope();
  const signature = signAgentMessage(agentRequestMessage(env), kp.secretKey);
  assert.equal(
    verifyAgentSignature({ address: other.publicKey.toBase58(), message: agentRequestMessage(env), signature }),
    false,
  );
  const tampered = agentRequestMessage({ ...env, body: { status: "evil" } });
  assert.equal(verifyAgentSignature({ address: kp.publicKey.toBase58(), message: tampered, signature }), false);
});

test("junk signatures and addresses are rejected, not thrown", () => {
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();
  for (const signature of ["", "0xdeadbeef", "not base58 at all!", bs58.encode(new Uint8Array(32))]) {
    assert.equal(verifyAgentSignature({ address, message: "m", signature }), false, signature);
  }
  const sig = signAgentMessage("m", kp.secretKey);
  assert.equal(verifyAgentSignature({ address: "0x1111111111111111111111111111111111111111", message: "m", signature: sig }), false);
});

test("addresses are validated as base58 and never lowercased", () => {
  const key = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  assert.equal(normalizeAddress(key), key);
  assert.equal(normalizeAddress(` ${key} `), key);
  assert.notEqual(normalizeAddress(key.toLowerCase()), key, "case is significant in base58");
  assert.equal(normalizeAddress("0x1111111111111111111111111111111111111111"), null);
  assert.equal(normalizeAddress(42), null);
});

test("write params are validated before anything touches the chain", () => {
  const ok = parseWriteParams(
    "createClaim",
    {
      question: "Will SOL close above $200 on Friday?",
      creatorPosition: "Yes",
      counterPosition: "No",
      resolutionUrl: "https://www.coingecko.com/en/coins/solana",
      category: "crypto",
      stakeUsdc: 2.5,
      deadline: NOW_SEC + 86_400,
    },
    NOW_SEC,
  );
  assert.equal(ok.action, "createClaim");
  assert.equal(stakeOf(ok), 2_500_000n);

  const cases: Array<[Parameters<typeof parseWriteParams>[0], Record<string, unknown>]> = [
    ["challenge", { claimId: 0, stakeUsdc: 2 }],
    ["challenge", { claimId: 1, stakeUsdc: 1 }],
    ["challenge", { claimId: "1e3", stakeUsdc: 2 }],
    ["deposit", { amountUsdc: -1 }],
    ["deposit", { amountUsdc: 1.0000001 }],
    ["createClaim", { question: "x", creatorPosition: "a", counterPosition: "b", resolutionUrl: "http://a.b", stakeUsdc: 2, deadline: NOW_SEC + 86_400 }],
    ["createClaim", { question: "x".repeat(201), creatorPosition: "a", counterPosition: "b", resolutionUrl: "https://a.b", stakeUsdc: 2, deadline: NOW_SEC + 86_400 }],
    ["createClaim", { question: "x", creatorPosition: "a", counterPosition: "b", resolutionUrl: "https://a.b", stakeUsdc: 2, deadline: NOW_SEC + 60 }],
  ];
  for (const [action, body] of cases) {
    assert.throws(
      () => parseWriteParams(action, body, NOW_SEC),
      (err: unknown) => err instanceof AgentEnvelopeError && err.reason === "bad_params",
      JSON.stringify(body),
    );
  }
});

test("usdc amounts convert to exact base units", () => {
  assert.equal(usdcToUnits(2, "x"), 2_000_000n);
  assert.equal(usdcToUnits(0.000001, "x"), 1n);
  assert.equal(usdcToUnits(12.345678, "x"), 12_345_678n);
});
