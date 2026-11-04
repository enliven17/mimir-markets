import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { normalizeOwner, verifyOwnerSignature } from "../../lib/owner";
import { parseProofHeader, formatProofHeader, walletProofMessage } from "../../lib/wallet-proof";
import { createHostedWallet, openHostedWallet } from "../../lib/solana/hosted-wallet";
import { solanaChallengeQuote } from "../../lib/solana/quote";
import { MARKET_CHAINS, isMarketChainId, explorerUrl, marketChain } from "../../lib/chains/registry";
import { launchMessage } from "../../lib/launch/auth";

const signed = (key: Keypair, message: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey));

test("only Solana is enabled and every explorer link pins devnet", () => {
  assert.deepEqual(MARKET_CHAINS.enabled, ["solana"]);
  assert.equal(isMarketChainId("base"), false);
  assert.equal(isMarketChainId("arc"), false);
  assert.equal(isMarketChainId("mainnet"), false);
  assert.equal(new URL(explorerUrl(marketChain("solana"), "tx", "signature")).searchParams.get("cluster"), "devnet");
  assert.equal(marketChain("solana").usdc.decimals, 6);
});

test("native owner proofs reject altered messages, other wallets and EVM identities", async () => {
  const a = Keypair.generate(), b = Keypair.generate(), address = a.publicKey.toBase58(), now = Date.now();
  const message = walletProofMessage(address, now), signature = signed(a, message);
  assert.equal(normalizeOwner(address), address);
  assert.equal(normalizeOwner("0x1234567890123456789012345678901234567890"), null);
  assert.equal(await verifyOwnerSignature({ address, message, signature }), true);
  assert.equal(await verifyOwnerSignature({ address, message: message + "withdraw", signature }), false);
  assert.equal(await verifyOwnerSignature({ address: b.publicKey.toBase58(), message, signature }), false);
  assert.deepEqual(parseProofHeader(formatProofHeader(now, signature), now), { signedAt: now, signature });
  assert.equal(parseProofHeader(formatProofHeader(now, signature), now + 86_400_001), null);
});

test("agent signatures bind the body, action and agent", async () => {
  const key = Keypair.generate(), address = key.publicKey.toBase58();
  const payload = { action: "create" as const, owner: address, agent: "new", bodySha256: "a".repeat(64), signedAt: Date.now() };
  const signature = signed(key, launchMessage(payload));
  assert.equal(await verifyOwnerSignature({ address, message: launchMessage(payload), signature }), true);
  for (const change of [{ action: "withdraw" as const }, { agent: "other" }, { bodySha256: "b".repeat(64) }]) {
    assert.equal(await verifyOwnerSignature({ address, message: launchMessage({ ...payload, ...change }), signature }), false);
  }
});

test("hosted wallet encryption rejects moving or changing ciphertext and key rotation", () => {
  const old = process.env.SOLANA_WALLET_SECRET;
  try {
    process.env.SOLANA_WALLET_SECRET = "a".repeat(64);
    const wallet = createHostedWallet();
    assert.equal(openHostedWallet(wallet).publicKey.toBase58(), wallet.address);
    assert.throws(() => openHostedWallet({ ...wallet, walletId: "another-wallet" }));
    assert.throws(() => openHostedWallet({ ...wallet, address: Keypair.generate().publicKey.toBase58() }));
    const raw = Buffer.from(wallet.sealed, "base64"); raw[30] ^= 1;
    assert.throws(() => openHostedWallet({ ...wallet, sealed: raw.toString("base64") }));
    process.env.SOLANA_WALLET_SECRET = "b".repeat(64);
    assert.throws(() => openHostedWallet(wallet));
  } finally { if (old === undefined) delete process.env.SOLANA_WALLET_SECRET; else process.env.SOLANA_WALLET_SECRET = old; }
});

test("native quotes use the whole creator stake and profit fees with SPL rounding", () => {
  const scale = 10n ** 18n;
  const m = { stakeA: (100n * scale).toString(), stakeB: "0", platformFeeBps: 50, agentFeeBps: 50, feeRecipient: "platform" };
  const q = solanaChallengeQuote(m, 2n * scale, "challenger");
  // A 2-USDC challenger against an unchallenged 100-USDC creator earns 100,
  // less a 0.5-USDC profit fee. The EVM risk cap does not apply to this program.
  assert.equal(q.risk, 2n * scale);
  assert.equal(q.fee, scale / 2n);
  assert.equal(q.win, 1015n * scale / 10n);
  assert.equal(solanaChallengeQuote(m, 2n * scale, "platform").fee, 0n);
});
