import assert from "node:assert/strict";
import test from "node:test";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAddress } from "viem";

import { arcConfig } from "../../lib/arc/config";
import {
  bytes32ToEvmAddress,
  bytes32ToSolanaAddress,
  evmAddressToBytes,
  evmAddressToBytes32,
  formatUsdcUnits,
  normalizeArcAddress,
  parseUsdcAmount,
  solanaAddressToBytes32,
} from "../../lib/arc/encoding";
import { fastMaxFee, isValidBurnTx, parseFastFeeBps, parseIrisMessages } from "../../lib/arc/iris";

const ARC = "0xf221c6a0e3a1a3c8b1d1d3d7ab0b6e2b1e9cc36f";

test("an EVM address becomes 12 zero bytes + its 20 bytes, and back", () => {
  const b32 = evmAddressToBytes32(ARC);
  assert.equal(b32, `0x${"00".repeat(12)}${ARC.slice(2)}`);
  assert.equal(b32.length, 66);
  assert.equal(bytes32ToEvmAddress(b32), normalizeArcAddress(ARC));
  assert.equal(evmAddressToBytes(ARC).length, 32);
  // The PoC built the same Pubkey-shaped recipient by hand.
  assert.deepEqual(evmAddressToBytes(ARC), new Uint8Array([...new Uint8Array(12), ...Buffer.from(ARC.slice(2), "hex")]));
  assert.throws(() => evmAddressToBytes32("0x1234"));
  assert.throws(() => bytes32ToEvmAddress(`0x${"11".repeat(32)}`));
});

test("a Solana address is its 32 raw bytes, and back", () => {
  const owner = Keypair.generate().publicKey;
  const ata = getAssociatedTokenAddressSync(new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"), owner);
  const b32 = solanaAddressToBytes32(ata.toBase58());
  assert.equal(b32, `0x${Buffer.from(ata.toBytes()).toString("hex")}`);
  assert.equal(bytes32ToSolanaAddress(b32), ata.toBase58());
  assert.throws(() => solanaAddressToBytes32("not-base58-0OIl"));
  assert.throws(() => solanaAddressToBytes32("3yZe7d"));
});

test("Arc addresses are checksummed or rejected", () => {
  assert.equal(normalizeArcAddress(ARC), getAddress(ARC));
  assert.equal(normalizeArcAddress(`0x${ARC.slice(2).toUpperCase()}`), getAddress(ARC));
  assert.equal(normalizeArcAddress("0x123"), null);
  assert.equal(normalizeArcAddress(42), null);
});

test("USDC amounts parse as exact base units", () => {
  assert.equal(parseUsdcAmount("1"), 1_000_000n);
  assert.equal(parseUsdcAmount("0.5"), 500_000n);
  assert.equal(parseUsdcAmount(" 2.000001 "), 2_000_001n);
  assert.equal(parseUsdcAmount("1."), 1_000_000n);
  assert.equal(parseUsdcAmount("0"), null);
  assert.equal(parseUsdcAmount("0.0000001"), null);
  assert.equal(parseUsdcAmount("-1"), null);
  assert.equal(parseUsdcAmount("1e6"), null);
  assert.equal(formatUsdcUnits(1_500_000n), "1.5");
  assert.equal(formatUsdcUnits(0n), "0");
  assert.equal(formatUsdcUnits(10_000_001n), "10.000001");
});

test("Iris: burn tx formats per domain, message parsing, fast fee", () => {
  assert.ok(isValidBurnTx(26, `0x${"ab".repeat(32)}`));
  assert.ok(!isValidBurnTx(26, "0xabc"));
  assert.ok(isValidBurnTx(5, "5".repeat(88)));
  assert.ok(!isValidBurnTx(5, `0x${"ab".repeat(32)}`));
  assert.ok(!isValidBurnTx(7, "5".repeat(88)));

  assert.deepEqual(parseIrisMessages({ messages: [{ status: "pending_confirmations", attestation: "PENDING" }] }), { status: "pending" });
  assert.deepEqual(parseIrisMessages({ messages: [{ status: "complete", message: "0x01", attestation: "PENDING" }] }), { status: "pending" });
  assert.deepEqual(parseIrisMessages({ messages: [{ status: "complete", message: "0x01", attestation: "0x02" }] }), {
    status: "complete",
    message: "0x01",
    attestation: "0x02",
  });
  assert.deepEqual(parseIrisMessages(null), { status: "pending" });

  assert.equal(parseFastFeeBps([{ finalityThreshold: 1000, minimumFee: 1 }, { finalityThreshold: 2000, minimumFee: 0 }]), 1);
  assert.equal(parseFastFeeBps({ data: [{ finalityThreshold: 1000, minimumFee: 1.3 }] }), 1.3);
  assert.equal(parseFastFeeBps([]), null);
  // 1 USDC at 1 bp = 100 units, + 100 headroom; fractional bps round up.
  assert.equal(fastMaxFee(1_000_000n, 1), 200n);
  assert.equal(fastMaxFee(1_000_000n, 1.3), 230n);
  assert.equal(fastMaxFee(1n, 1), 101n);
});

test("config: testnet by default, mainnet refuses to guess the RPC", () => {
  const t = arcConfig({});
  assert.equal(t.network, "testnet");
  assert.equal(t.chain.id, 5042002);
  assert.equal(t.solana.cluster, "devnet");
  assert.equal(t.circle.modularUrl.endsWith("/arcTestnet"), true);
  assert.throws(() => arcConfig({ network: "mainnet" }), /NEXT_PUBLIC_ARC_RPC/);
  const m = arcConfig({ network: "mainnet", rpcUrl: "https://rpc.example" });
  assert.equal(m.solana.usdcMint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(m.cctp.irisUrl, "https://iris-api.circle.com");
});
