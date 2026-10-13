import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { PROGRAMS } from "../../lib/launch/solana/policy";
import { assertFullySigned, fillFrom, inspectTx, sendAndConfirm, settleSignature, walletDeltas, WSOL } from "../../lib/launch/solana/tx";
import { fakeConnection, fastSend, unsignedTx } from "../../lib/launch/solana/testkit";
import { AmbiguousSendError, SolanaError, TxFailedError } from "../../lib/launch/solana/util";

const wallet = Keypair.generate();
const W = wallet.publicKey.toBase58();
const MINT = "5dn8Bz1Kx8d9SdCgvHPiYLwCoUhGU1Hfdq47vSbWpump";

/** A confirmed PumpPortal curve buy as getTransaction(…, {maxSupportedTransactionVersion: 0}) returns it. */
function curveBuyResponse(): VersionedTransactionResponse {
  const ata = Keypair.generate().publicKey;
  const curve = Keypair.generate().publicKey;
  const lookedUp = Keypair.generate().publicKey; // pump global/fee accounts come from the ALT
  const alt = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [lookedUp] } });
  const msg = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: bs58.encode(Buffer.alloc(32, 3)),
    instructions: [
      new TransactionInstruction({ programId: new PublicKey(PROGRAMS.computeBudget), keys: [], data: Buffer.from([2, 0x10, 0x98, 2, 0]) }),
      new TransactionInstruction({ programId: new PublicKey(PROGRAMS.associatedToken), keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }], data: Buffer.from([1]) }),
      new TransactionInstruction({ programId: new PublicKey(PROGRAMS.pumpPortalRouter), keys: [{ pubkey: curve, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: lookedUp, isSigner: false, isWritable: false }], data: Buffer.from([0x66]) }),
    ],
  }).compileToV0Message([alt]);
  const tx = new VersionedTransaction(msg);
  tx.sign([wallet]);
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const iAta = keys.indexOf(ata.toBase58());
  const iCurve = keys.indexOf(curve.toBase58());
  const pre = keys.map(() => 1_461_600);
  const post = [...pre];
  pre[0] = 1_000_000_000;
  post[0] = 897_910_920; // -100_000_000 trade -15_000 fees -2_074_080 Token-2022 ATA rent
  pre[iAta] = 0;
  post[iAta] = 2_074_080;
  post[iCurve] = pre[iCurve] + 100_000_000;
  return {
    slot: 371_000_000,
    blockTime: 1_791_200_000,
    version: 0,
    transaction: { message: msg, signatures: [bs58.encode(tx.signatures[0])] },
    meta: {
      err: null,
      fee: 15_000,
      preBalances: [...pre, 1_000],
      postBalances: [...post, 1_000],
      preTokenBalances: [{ accountIndex: keys.length, mint: WSOL, owner: lookedUp.toBase58(), uiTokenAmount: { amount: "1", decimals: 9, uiAmount: 0, uiAmountString: "0" } }],
      postTokenBalances: [
        { accountIndex: iAta, mint: MINT, owner: W, programId: PROGRAMS.token2022, uiTokenAmount: { amount: "3456789012345", decimals: 6, uiAmount: 3456789.012345, uiAmountString: "3456789.012345" } },
        { accountIndex: keys.length, mint: WSOL, owner: lookedUp.toBase58(), uiTokenAmount: { amount: "1", decimals: 9, uiAmount: 0, uiAmountString: "0" } },
      ],
      loadedAddresses: { writable: [], readonly: [lookedUp] },
      innerInstructions: [],
      logMessages: [],
      computeUnitsConsumed: 61_000,
    },
  } as unknown as VersionedTransactionResponse;
}

test("fill parsing: curve buy measures SOL spent incl. fee + rent, tokens received, decimals", () => {
  const r = curveBuyResponse();
  const d = walletDeltas(r, W, MINT);
  assert.equal(d.lamports, BigInt(-102_089_080));
  assert.equal(d.fee, BigInt(15_000));
  assert.deepEqual(fillFrom(d, "buy"), { sig: r.transaction.signatures[0], lamports: BigInt(102_089_080), tokens: BigInt("3456789012345"), decimals: 6 });
});

test("fill parsing: sell counts unwrapped pre-existing WSOL as SOL, not as proceeds", () => {
  const r = curveBuyResponse();
  const meta = r.meta!;
  const iWallet = 0;
  // Turn it into a Jupiter sell: wallet had 1_000_000 WSOL that the cleanup CloseAccount unwrapped.
  meta.preBalances[iWallet] = 500_000_000;
  meta.postBalances[iWallet] = 500_000_000 + 250_000_000 + 1_000_000 - 15_000;
  meta.preTokenBalances = [
    { accountIndex: 1, mint: MINT, owner: W, uiTokenAmount: { amount: "1000000", decimals: 6, uiAmount: 1, uiAmountString: "1" } },
    { accountIndex: 2, mint: WSOL, owner: W, uiTokenAmount: { amount: "1000000", decimals: 9, uiAmount: 0.001, uiAmountString: "0.001" } },
  ];
  meta.postTokenBalances = [{ accountIndex: 1, mint: MINT, owner: W, uiTokenAmount: { amount: "0", decimals: 6, uiAmount: 0, uiAmountString: "0" } }];
  assert.deepEqual(fillFrom(walletDeltas(r, W, MINT), "sell"), { sig: r.transaction.signatures[0], lamports: BigInt(249_985_000), tokens: BigInt(1_000_000), decimals: 6 });
});

test("fill parsing: failed tx and foreign wallet are errors", () => {
  const r = curveBuyResponse();
  assert.throws(() => walletDeltas(r, Keypair.generate().publicKey.toBase58(), MINT), /is not in transaction/);
  r.meta!.err = { InstructionError: [2, { Custom: 6002 }] };
  assert.throws(() => walletDeltas(r, W, MINT), TxFailedError);
});

test("inspectTx: fee payer, signer set and program allow-list", () => {
  const mint = Keypair.generate().publicKey;
  const ok = unsignedTx(wallet.publicKey, [PROGRAMS.computeBudget, PROGRAMS.pump], [mint]);
  inspectTx(ok, { feePayer: W, allowedPrograms: [PROGRAMS.computeBudget, PROGRAMS.pump], extraSigners: [mint.toBase58()] });
  assert.throws(() => inspectTx(ok, { feePayer: W, allowedPrograms: [PROGRAMS.computeBudget, PROGRAMS.pump] }), /unexpected signers/);
  const evil = unsignedTx(wallet.publicKey, [PROGRAMS.computeBudget, Keypair.generate().publicKey.toBase58()]);
  assert.throws(() => inspectTx(evil, { feePayer: W, allowedPrograms: [PROGRAMS.computeBudget] }), /non-allowed program/);
  const otherPayer = unsignedTx(Keypair.generate().publicKey, [PROGRAMS.computeBudget]);
  assert.throws(() => inspectTx(otherPayer, { feePayer: W, allowedPrograms: [PROGRAMS.computeBudget] }), /unexpected signers/);
});

test("assertFullySigned: catches a missing signature and a modified message", () => {
  const tx = unsignedTx(wallet.publicKey, [PROGRAMS.computeBudget]);
  const msg = tx.message.serialize();
  assert.throws(() => assertFullySigned(tx, msg), /missing\/invalid signature/);
  tx.sign([wallet]);
  assertFullySigned(tx, msg);
  const other = new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: bs58.encode(Buffer.alloc(32, 1)), instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message());
  other.sign([wallet]);
  assert.throws(() => assertFullySigned(other, msg), /changed the transaction message/);
});

const signed = () => {
  const tx = unsignedTx(wallet.publicKey, [PROGRAMS.computeBudget]);
  tx.sign([wallet]);
  return tx;
};

test("sendAndConfirm: confirmed -> sig", async () => {
  const conn = fakeConnection();
  const tx = signed();
  assert.equal(await sendAndConfirm(conn, tx, 100, fastSend), bs58.encode(tx.signatures[0]));
  assert.equal(conn.counters.send, 1);
});

test("sendAndConfirm: preflight rejection is provably not landed", async () => {
  const conn = fakeConnection({ sendError: () => new Error("failed to send transaction: Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1772") });
  await assert.rejects(sendAndConfirm(conn, signed(), 100, fastSend), (e: SolanaError) => e.notLanded && /preflight rejected/.test(e.message));
});

test("sendAndConfirm: send timed out, blockhash expired past the margin on the sticky endpoint AND unknown to a second endpoint -> not landed", async () => {
  const conn = fakeConnection({ sendError: (n) => (n === 1 ? new Error("fetch failed: socket hang up") : null), status: () => null, blockHeight: (n) => (n < 3 ? 90 : 301) });
  const witness = fakeConnection({ status: () => null, blockHeight: () => 301 });
  await assert.rejects(sendAndConfirm(conn, signed(), 150, { ...fastSend, timeoutMs: 5_000, witnesses: [witness] }), (e: SolanaError) => e.notLanded && e.code === "EXPIRED");
  assert.ok(conn.sent.every((t) => bs58.encode(t.signatures[0]) === bs58.encode(conn.sent[0].signatures[0])), "only the same bytes are rebroadcast");
  assert.equal(witness.counters.send, 0, "the witness is only asked, never sent to");
});

test("H1: expired by lastValidBlockHeight but inside the margin -> never not-landed", async () => {
  const conn = fakeConnection({ sendError: () => new Error("socket hang up"), status: () => null, blockHeight: () => 299 });
  const witness = fakeConnection({ status: () => null, blockHeight: () => 10_000 });
  await assert.rejects(sendAndConfirm(conn, signed(), 150, { ...fastSend, witnesses: [witness] }), (e: SolanaError) => e instanceof AmbiguousSendError && !e.notLanded);
});

test("H1: expired on the sticky endpoint but no second endpoint to confirm -> ambiguous, never not-landed", async () => {
  const conn = fakeConnection({ sendError: () => new Error("socket hang up"), status: () => null, blockHeight: () => 10_000 });
  await assert.rejects(sendAndConfirm(conn, signed(), 150, fastSend), (e: SolanaError) => e instanceof AmbiguousSendError && !e.notLanded);
});

test("H1: the sticky endpoint lost the sig but the second endpoint saw it land -> confirmed (no rebuild, no double pay)", async () => {
  const conn = fakeConnection({ sendError: () => new Error("socket hang up"), status: () => null, blockHeight: () => 10_000 });
  const witness = fakeConnection({ status: () => "confirmed", blockHeight: () => 10_000 });
  const tx = signed();
  assert.equal(await sendAndConfirm(conn, tx, 150, { ...fastSend, witnesses: [witness] }), bs58.encode(tx.signatures[0]));
});

test("H1: a lagging second endpoint (its own height inside the window) cannot confirm not-landed", async () => {
  const conn = fakeConnection({ sendError: () => new Error("socket hang up"), status: () => null, blockHeight: () => 10_000 });
  const lagging = fakeConnection({ status: () => null, blockHeight: () => 200 });
  await assert.rejects(sendAndConfirm(conn, signed(), 150, { ...fastSend, witnesses: [lagging] }), (e: SolanaError) => e instanceof AmbiguousSendError);
});

test("H1: \"Blockhash not found\" from a rebroadcast after the first send is ambiguous, never not-landed", async () => {
  const conn = fakeConnection({ sendError: (n) => (n === 1 ? new Error("socket hang up") : new Error("Transaction simulation failed: Blockhash not found")), status: () => null, blockHeight: () => 10 });
  await assert.rejects(sendAndConfirm(conn, signed(), 150, fastSend), (e: SolanaError) => e instanceof AmbiguousSendError && !e.notLanded);
});

test("settleSignature: landed / failed on either endpoint; not-landed only with both past the margin", async () => {
  const sig = "sig";
  const up = (status: "confirmed" | null | { err: unknown }, h: number) => fakeConnection({ status: () => status, blockHeight: () => h });
  assert.equal((await settleSignature(up("confirmed", 0), [], sig, 100)).state, "landed");
  assert.equal((await settleSignature(up({ err: 1 }, 0), [], sig, 100)).state, "failed");
  assert.equal((await settleSignature(up(null, 251), [up(null, 251)], sig, 100)).state, "notLanded");
  assert.equal((await settleSignature(up(null, 250), [up(null, 999)], sig, 100)).state, "unknown");
  assert.equal((await settleSignature(up(null, 999), [], sig, 100)).state, "unknown");
  assert.equal((await settleSignature(up(null, 999), [up("confirmed", 999)], sig, 100)).state, "landed");
});

test("sendAndConfirm: cannot decide before the deadline -> AmbiguousSendError (never 'not landed')", async () => {
  const conn = fakeConnection({ sendError: () => new Error("ETIMEDOUT"), status: () => null, blockHeight: () => 10 });
  await assert.rejects(sendAndConfirm(conn, signed(), 150, fastSend), (e: SolanaError) => e instanceof AmbiguousSendError && !e.notLanded);
});

test("sendAndConfirm: landed with a program error -> TxFailedError", async () => {
  const conn = fakeConnection({ status: () => ({ err: { InstructionError: [1, { Custom: 6002 }] } }) });
  await assert.rejects(sendAndConfirm(conn, signed(), 150, fastSend), TxFailedError);
});
