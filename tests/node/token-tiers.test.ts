import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

import {
  agentRegisterGateFromEnv,
  basketMinTierFromEnv,
  gateEnabled,
  meetsGate,
  rateLimitFor,
  tierAtLeast,
  tierFor,
  tierThresholdsFromEnv,
} from "../../lib/token-tiers";
import { formatProofHeader, holderProofMessage, parseProofHeader } from "../../lib/token-proof";
import { encodeSignature, verifyAgentSignature } from "../../lib/agents/signature";

const T = { holder: 10_000, backer: 1_000_000, oracleCircle: 10_000_000, ansemHolderMin: 100 };

test("tierFor maps MIMIR balances onto thresholds", () => {
  assert.equal(tierFor({ mimir: 0, ansem: 0 }, T), "none");
  assert.equal(tierFor({ mimir: 9_999, ansem: 0 }, T), "none");
  assert.equal(tierFor({ mimir: 10_000, ansem: 0 }, T), "holder");
  assert.equal(tierFor({ mimir: 1_000_000, ansem: 0 }, T), "backer");
  assert.equal(tierFor({ mimir: 50_000_000, ansem: 0 }, T), "oracle-circle");
  assert.equal(tierFor({ mimir: Number.NaN, ansem: 0 }, T), "none");
});

test("$ANSEM holders count as HOLDER, never higher, and only when enabled", () => {
  assert.equal(tierFor({ mimir: 0, ansem: 100 }, T), "holder");
  assert.equal(tierFor({ mimir: 0, ansem: 99 }, T), "none");
  assert.equal(tierFor({ mimir: 0, ansem: 1e12 }, T), "holder");
  assert.equal(tierFor({ mimir: 2_000_000, ansem: 1e6 }, T), "backer");
  assert.equal(tierFor({ mimir: 0, ansem: 1e6 }, { ...T, ansemHolderMin: 0 }), "none");
});

test("a zero threshold never makes an empty wallet a holder", () => {
  assert.equal(tierFor({ mimir: 0, ansem: 0 }, { holder: 0, backer: 0, oracleCircle: 0, ansemHolderMin: 0 }), "none");
});

test("thresholds read from env with safe fallbacks", () => {
  const t = tierThresholdsFromEnv({ MIMIR_TIER_HOLDER_MIN: "5", MIMIR_TIER_BACKER_MIN: "bad", ANSEM_HOLDER_MIN: "-1" });
  assert.equal(t.holder, 5);
  assert.equal(t.backer, 1_000_000);
  assert.equal(t.ansemHolderMin, 100);
});

test("rate limits scale by tier", () => {
  assert.equal(rateLimitFor(30, "none"), 30);
  assert.equal(rateLimitFor(30, "holder"), 60);
  assert.equal(rateLimitFor(5, "oracle-circle"), 40);
  assert.ok(tierAtLeast("backer", "holder"));
  assert.ok(!tierAtLeast("holder", "backer"));
});

test("holding gates: off by default, either path passes", () => {
  const off = agentRegisterGateFromEnv(true, {});
  assert.ok(!gateEnabled(off));
  assert.ok(meetsGate({ mimir: 0, ansem: 0 }, off));

  // The MIMIR path is ignored until the token launches.
  assert.ok(!gateEnabled(agentRegisterGateFromEnv(false, { AGENT_REGISTER_MIN_MIMIR: "1000" })));

  const g = agentRegisterGateFromEnv(true, { AGENT_REGISTER_MIN_MIMIR: "1000", AGENT_REGISTER_MIN_ANSEM: "50" });
  assert.ok(meetsGate({ mimir: 1000, ansem: 0 }, g));
  assert.ok(meetsGate({ mimir: 0, ansem: 50 }, g));
  assert.ok(!meetsGate({ mimir: 999, ansem: 49 }, g));
});

test("basket tier gate needs a launched token and a known tier", () => {
  assert.equal(basketMinTierFromEnv(false, { BASKET_CREATE_MIN_TIER: "holder" }), "none");
  assert.equal(basketMinTierFromEnv(true, { BASKET_CREATE_MIN_TIER: "Backer" }), "backer");
  assert.equal(basketMinTierFromEnv(true, { BASKET_CREATE_MIN_TIER: "whale" }), "none");
});

test("holder proof round-trips, binds the wallet and expires", () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const now = Date.now();
  const sig = encodeSignature(nacl.sign.detached(new TextEncoder().encode(holderProofMessage(wallet, now)), kp.secretKey));
  const parsed = parseProofHeader(formatProofHeader(now, sig), now);
  assert.ok(parsed);
  assert.ok(verifyAgentSignature({ address: wallet, message: holderProofMessage(wallet, parsed.signedAt), signature: parsed.signature }));
  // Another wallet cannot reuse it.
  const other = Keypair.generate().publicKey.toBase58();
  assert.ok(!verifyAgentSignature({ address: other, message: holderProofMessage(other, now), signature: sig }));
  assert.equal(parseProofHeader(formatProofHeader(now, sig), now + 25 * 3_600_000), null);
  assert.equal(parseProofHeader(formatProofHeader(now + 3_600_000, sig), now), null);
  assert.equal(parseProofHeader("garbage", now), null);
});
