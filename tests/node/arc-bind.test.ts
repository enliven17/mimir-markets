import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@solana/web3.js";
import { getAddress } from "viem";

import { signAgentMessage } from "../../lib/agents/signature";
import { ARC_BIND_TTL_MS, arcBindMessage, checkArcBindBody, isFreshArcBind } from "../../lib/arc/bind";

const ARC_ADDR = getAddress("0xf221c6a0e3a1a3c8b1d1d3d7ab0b6e2b1e9cc36f");
const ARC_SIG = `0x${"ab".repeat(65)}`;
const NOW = 1_780_000_000_000;

function signedBody(kp: Keypair, overrides: Record<string, unknown> = {}) {
  const solana = kp.publicKey.toBase58();
  const signedAt = NOW - 1000;
  const message = arcBindMessage(solana, ARC_ADDR, signedAt);
  return {
    solana,
    arc: ARC_ADDR,
    signedAt,
    solanaSignature: signAgentMessage(message, kp.secretKey),
    arcSignature: ARC_SIG,
    credentialId: "Zm9vYmFyYmF6cXV4MTIzNA",
    ...overrides,
  };
}

test("the bind message names both addresses and the time, one per line", () => {
  const m = arcBindMessage("SoLaNa", "0xAbC", 1234);
  assert.equal(m.split("\n")[0], "Mimir Arc account");
  assert.match(m, /^solana: SoLaNa$/m);
  assert.match(m, /^arc: 0xAbC$/m);
  assert.match(m, /^signedAt: 1234$/m);
  assert.match(m, /moves no funds/);
});

test("freshness: five minutes either way", () => {
  assert.ok(isFreshArcBind(NOW, NOW));
  assert.ok(isFreshArcBind(NOW - ARC_BIND_TTL_MS, NOW));
  assert.ok(!isFreshArcBind(NOW - ARC_BIND_TTL_MS - 1, NOW));
  assert.ok(!isFreshArcBind(NOW + ARC_BIND_TTL_MS + 1, NOW));
  assert.ok(!isFreshArcBind(Number.NaN, NOW));
});

test("a body signed by the Solana wallet passes, with a checksummed Arc address", () => {
  const kp = Keypair.generate();
  const res = checkArcBindBody(signedBody(kp), NOW);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.request.solana, kp.publicKey.toBase58());
  assert.equal(res.request.arc, ARC_ADDR);
  assert.equal(res.request.credentialId, "Zm9vYmFyYmF6cXV4MTIzNA");
  assert.equal(res.message, arcBindMessage(kp.publicKey.toBase58(), ARC_ADDR, NOW - 1000));
});

test("the signature must come from the named wallet, over this exact message", () => {
  const kp = Keypair.generate();
  const other = Keypair.generate();
  // Signed by someone else.
  const stolen = signedBody(other, { solana: kp.publicKey.toBase58() });
  assert.deepEqual(checkArcBindBody(stolen, NOW), { ok: false, status: 401, error: "the Solana signature does not match" });
  // Signed for another Arc account, then pointed at this one.
  const swapped = signedBody(kp, { arc: "0x0000000000000000000000000000000000000001" });
  assert.equal(checkArcBindBody(swapped, NOW).ok, false);
});

test("stale, malformed and incomplete bodies are refused", () => {
  const kp = Keypair.generate();
  const stale = checkArcBindBody(signedBody(kp), NOW + ARC_BIND_TTL_MS + 5000);
  assert.equal(stale.ok ? 0 : stale.status, 401);
  assert.equal(checkArcBindBody(signedBody(kp, { solana: "nope" }), NOW).ok, false);
  assert.equal(checkArcBindBody(signedBody(kp, { arc: "0x123" }), NOW).ok, false);
  assert.equal(checkArcBindBody(signedBody(kp, { arcSignature: "deadbeef" }), NOW).ok, false);
  // A malformed credential id is dropped, not trusted.
  const res = checkArcBindBody(signedBody(kp, { credentialId: "<script>" }), NOW);
  assert.ok(res.ok && res.request.credentialId === null);
});
