// The drain attacks from the security review, built as real transactions: each must be refused
// before a signature is ever requested.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createApproveInstruction, createCloseAccountInstruction, createSetAuthorityInstruction, createSyncNativeInstruction, createTransferInstruction, AuthorityType, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { ALLOWED_PROGRAMS, PROGRAMS, wsolAccount } from "../../lib/launch/solana/policy";
import { inspectTx } from "../../lib/launch/solana/tx";
import { createSubmitter } from "../../lib/launch/solana/submit";
import { fakeConnection, fakePrivy, fastSend } from "../../lib/launch/solana/testkit";

const walletKp = Keypair.generate();
const wallet = walletKp.publicKey;
const W = wallet.toBase58();
const attacker = Keypair.generate().publicKey;
const wsol = new PublicKey(wsolAccount(W));
const PROGS = [...ALLOWED_PROGRAMS, PROGRAMS.system];

const tx = (...ixs: TransactionInstruction[]) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions: ixs }).compileToV0Message());
const check = (t: VersionedTransaction, to: string[] = []) => inspectTx(t, { feePayer: W, allowedPrograms: PROGS, allowedTransferTo: [wsol.toBase58(), ...to] });

test("wrap SOL then close the WSOL account to an attacker is refused", () => {
  const attack = tx(
    SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wsol, lamports: 5e9 }),
    createSyncNativeInstruction(wsol),
    createCloseAccountInstruction(wsol, attacker, wallet),
  );
  assert.throws(() => check(attack), /closed back to the wallet/);
});

test("the honest version (close back to the wallet) passes", () => {
  check(tx(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wsol, lamports: 1e9 }), createSyncNativeInstruction(wsol), createCloseAccountInstruction(wsol, wallet, wallet)));
});

test("approve, set-authority and direct token transfers are refused (Token and Token-2022)", () => {
  const ata = Keypair.generate().publicKey;
  assert.throws(() => check(tx(createApproveInstruction(ata, attacker, wallet, 1n))), /token instruction 4/);
  assert.throws(() => check(tx(createSetAuthorityInstruction(ata, wallet, AuthorityType.AccountOwner, attacker))), /token instruction 6/);
  assert.throws(() => check(tx(createTransferInstruction(ata, Keypair.generate().publicKey, wallet, 1n))), /token instruction 3/);
  assert.throws(() => check(tx(createTransferInstruction(ata, Keypair.generate().publicKey, wallet, 1n, [], TOKEN_2022_PROGRAM_ID))), /token instruction 3/);
});

test("SOL may only go to the explicit recipient; other system instructions are refused", () => {
  const creator = Keypair.generate().publicKey;
  assert.throws(() => check(tx(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: attacker, lamports: 1 }))), /SOL transfer to/);
  check(tx(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: creator, lamports: 1 })), [creator.toBase58()]);
  const assign = SystemProgram.assign({ accountPubkey: wallet, programId: attacker });
  assert.throws(() => check(tx(assign)), /system instruction 1/);
});

test("submitter: a tx that would take more SOL than its ceiling never reaches Privy", async () => {
  const conn = fakeConnection({ balance: 10_000_000_000n, simulateSolOut: 3_000_000_000n });
  const privy = fakePrivy(walletKp);
  const submitter = createSubmitter({ privy, connection: conn as never, send: fastSend, maxAttempts: 1 });
  const t = tx(new TransactionInstruction({ programId: new PublicKey(PROGRAMS.computeBudget), keys: [], data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]) }));
  await assert.rejects(
    submitter.run("sell", async () => ({ walletId: "w", wallet: W, unsigned: { tx: t } }), () => null),
    /would take 3000000000 lamports out of the wallet/,
  );
  assert.equal(privy.seen.length, 0, "Privy was never asked to sign");
});

// ---------------- M5: other token balances and the SOL a sell must bring back ----------------

const POS = Keypair.generate().publicKey; // a token held in an open position
const SOLD = Keypair.generate().publicKey;
const ataOf = (mint: PublicKey) => getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID).toBase58();
const tokenData = (amount: bigint) => {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(amount, 64);
  return data;
};
const tokenAcc = (amount: bigint) => ({ owner: TOKEN_2022_PROGRAM_ID, data: tokenData(amount), lamports: 2_039_280, executable: false, rentEpoch: 0 });
const noop = () => tx(new TransactionInstruction({ programId: new PublicKey(PROGRAMS.computeBudget), keys: [], data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]) }));

function guarded(o: { pre: Record<string, bigint>; post: Record<string, bigint>; solIn?: bigint }) {
  const conn = fakeConnection({
    balance: 10_000_000_000n,
    simulateSolOut: -(o.solIn ?? 0n),
    accounts: new Map(Object.entries(o.pre).map(([k, v]) => [k, tokenAcc(v)])),
    simulateAccounts: new Map(Object.entries(o.post).map(([k, v]) => [k, tokenData(v)])),
  });
  const privy = fakePrivy(walletKp);
  return { submitter: createSubmitter({ privy, connection: conn as never, send: fastSend, maxAttempts: 1 }), privy };
}

test("M5: a tx that lowers the balance of an open position's token is refused before signing", async () => {
  const { submitter, privy } = guarded({ pre: { [ataOf(POS)]: 1_000n }, post: { [ataOf(POS)]: 0n } });
  await assert.rejects(
    submitter.run("sell", async () => ({ walletId: "w", wallet: W, unsigned: { tx: noop(), protectMints: [POS.toBase58()] } }), () => null),
    /would drop by 1000/,
  );
  assert.equal(privy.seen.length, 0);
});

test("M5: a sell may lower only the sold mint, and by at most the amount sold", async () => {
  const ok = guarded({ pre: { [ataOf(SOLD)]: 1_000n, [ataOf(POS)]: 7n }, post: { [ataOf(SOLD)]: 500n, [ataOf(POS)]: 7n } });
  await ok.submitter.run("sell", async () => ({ walletId: "w", wallet: W, unsigned: { tx: noop(), protectMints: [POS.toBase58()], spend: { mint: SOLD.toBase58(), amount: 500n } } }), () => null);
  assert.equal(ok.privy.seen.length, 1);
  const more = guarded({ pre: { [ataOf(SOLD)]: 1_000n }, post: { [ataOf(SOLD)]: 400n } });
  await assert.rejects(
    more.submitter.run("sell", async () => ({ walletId: "w", wallet: W, unsigned: { tx: noop(), spend: { mint: SOLD.toBase58(), amount: 500n } } }), () => null),
    /would drop by 600/,
  );
});

test("M5: a sell that brings back less SOL than the quote's minimum is refused", async () => {
  const { submitter, privy } = guarded({ pre: {}, post: {}, solIn: 1_000_000n });
  await assert.rejects(
    submitter.run("sell", async () => ({ walletId: "w", wallet: W, unsigned: { tx: noop(), minSolIn: 2_000_000n } }), () => null),
    /would receive 1000000 lamports, minimum 2000000/,
  );
  assert.equal(privy.seen.length, 0);
});
