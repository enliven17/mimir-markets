import assert from "node:assert/strict";
import test from "node:test";

import { type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { CallRevertedError, callToTx, eoaSession, type ArcCall } from "../../lib/arc/session";
import { normalizeOwner, verifyOwnerSignature } from "../../lib/owner";
import { formatProofHeader, parseProofHeader, WALLET_HEADER, WALLET_PROOF_HEADER, walletProofMessage } from "../../lib/wallet-proof";
import { provenWallet } from "../../lib/server/wallet-proof";

const WALLET = "0xb05F25Bc2eb9E1f7ad3F2371Eed2DE149Bd26a40" as Address;
const MARKET = "0x1111111111111111111111111111111111111111" as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** A fake wallet + chain: records what was sent, in order, and answers receipts from `statuses`. */
function fakeWallet(statuses: Array<"success" | "reverted"> = []) {
  const log: string[] = [];
  const txs: ReturnType<typeof callToTx>[] = [];
  let n = 0;
  const session = eoaSession({
    chainId: 5042002,
    address: WALLET,
    switchChain: async (id) => void log.push(`switch:${id}`),
    sendTransaction: async (tx) => {
      txs.push(tx);
      log.push(`send:${tx.to}`);
      return hash(++n);
    },
    waitForReceipt: async (h) => {
      log.push(`wait:${h}`);
      return { status: statuses[Number(BigInt(h)) - 1] ?? "success" };
    },
    signMessage: async () => "0xsig" as Hex,
  });
  return { session, log, txs };
}

test("callToTx: from the wallet, hex value, 0 when the call has none", () => {
  const call: ArcCall = { to: MARKET, data: "0x1234", value: 2_000_000_000_000_000_000n };
  assert.deepEqual(callToTx(WALLET, call), { from: WALLET, to: MARKET, data: "0x1234", value: "0x1bc16d674ec80000" });
  assert.equal(callToTx(WALLET, { to: MARKET, data: "0x" }).value, "0x0");
});

test("eoaSession sends each call in order, switching chain first and waiting for each receipt", async () => {
  const { session, log, txs } = fakeWallet();
  assert.equal(session.address, WALLET);
  assert.equal(session.chainId, 5042002);
  const r = await session.sendCalls([
    { to: MARKET, data: "0x01", value: 5n },
    { to: WALLET, data: "0x02" },
  ]);
  assert.deepEqual(r, { txHash: hash(2), txHashes: [hash(1), hash(2)] });
  assert.deepEqual(log, ["switch:5042002", `send:${MARKET}`, `wait:${hash(1)}`, "switch:5042002", `send:${WALLET}`, `wait:${hash(2)}`]);
  assert.equal(txs[0].value, "0x5");
});

test("eoaSession stops at the first revert and names its tx; refuses an empty batch", async () => {
  const { session, txs } = fakeWallet(["reverted", "success"]);
  await assert.rejects(session.sendCalls([{ to: MARKET, data: "0x01" }, { to: MARKET, data: "0x02" }]), (e) => e instanceof CallRevertedError && e.txHash === hash(1));
  assert.equal(txs.length, 1);
  await assert.rejects(session.sendCalls([]), /no calls/);
});

test("owner: a checksummed 0x address or null; Solana keys are no longer owners", () => {
  assert.equal(normalizeOwner(WALLET.toLowerCase()), WALLET);
  assert.equal(normalizeOwner(` ${WALLET} `), WALLET);
  assert.equal(normalizeOwner("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"), null);
  assert.equal(normalizeOwner(42), null);
});

test("verifyOwnerSignature: EIP-191 from the wallet passes, another signer or a base58 signature does not", async () => {
  const key = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const message = "Mimir test";
  assert.equal(await verifyOwnerSignature({ address: key.address, message, signature: await key.signMessage({ message }) }), true);
  assert.equal(await verifyOwnerSignature({ address: key.address, message, signature: await other.signMessage({ message }) }), false);
  assert.equal(await verifyOwnerSignature({ address: key.address, message, signature: "3".repeat(88) }), false);
});

test("provenWallet: a wallet-signed proof header proves the address; a forged, stale or base58 one does not", async () => {
  const key = privateKeyToAccount(generatePrivateKey());
  const signedAt = Date.now();
  const signature = await key.signMessage({ message: walletProofMessage(key.address, signedAt) });
  const req = (wallet: string, proof: string) => new Request("http://x/api/follows", { headers: { [WALLET_HEADER]: wallet, [WALLET_PROOF_HEADER]: proof } });
  assert.equal(await provenWallet(req(key.address.toLowerCase(), formatProofHeader(signedAt, signature))), key.address);
  assert.equal(parseProofHeader(`${signedAt - 25 * 3_600_000}.${signature}`), null);
  assert.equal(parseProofHeader(`${signedAt}.${"3".repeat(88)}`), null);
  const other = privateKeyToAccount(generatePrivateKey());
  const forged = await other.signMessage({ message: walletProofMessage(key.address, signedAt) });
  assert.equal(await provenWallet(req(key.address, formatProofHeader(signedAt, forged))), null);
});
