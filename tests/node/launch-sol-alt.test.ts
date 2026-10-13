// Address lookup tables: what a v0 transaction really touches is only known once its tables are
// resolved from chain. inspectTx must see those accounts, and refuse when it cannot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { ALLOWED_PROGRAMS, PROGRAMS, wsolAccount } from "../../lib/launch/solana/policy";
import { createLookupCache, resolveLookups, type LookupRpc } from "../../lib/launch/solana/alt";
import { inspectTx } from "../../lib/launch/solana/tx";

const walletKp = Keypair.generate();
const wallet = walletKp.publicKey;
const W = wallet.toBase58();
const PROGS = [...ALLOWED_PROGRAMS, PROGRAMS.system];
const U64_MAX = BigInt("18446744073709551615");

const table = (key: PublicKey, addresses: PublicKey[]) =>
  new AddressLookupTableAccount({ key, state: { deactivationSlot: U64_MAX, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses } });

/** A v0 tx compiled against `claimed` (what a builder says the table holds). */
const v0 = (ixs: TransactionInstruction[], claimed: AddressLookupTableAccount[]) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions: ixs }).compileToV0Message(claimed));

/** RPC whose tables hold `onChain` (key -> addresses), counting calls. */
function rpc(onChain: Map<string, PublicKey[]>) {
  const calls: string[] = [];
  const r: LookupRpc & { calls: string[] } = {
    calls,
    async getAddressLookupTable(key: PublicKey) {
      calls.push(key.toBase58());
      const addrs = onChain.get(key.toBase58());
      return { context: { slot: 42 }, value: addrs ? table(key, addrs) : null };
    },
  };
  return r;
}

const jupIx = (accounts: PublicKey[]) =>
  new TransactionInstruction({ programId: new PublicKey(PROGRAMS.jupiter), keys: [{ pubkey: wallet, isSigner: true, isWritable: true }, ...accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }))], data: Buffer.from([1]) });

test("ALT: a tx with lookups is refused unless its tables were resolved", () => {
  const key = Keypair.generate().publicKey;
  const pool = Keypair.generate().publicKey;
  const tx = v0([jupIx([pool])], [table(key, [pool])]);
  assert.equal(tx.message.addressTableLookups.length, 1);
  assert.throws(() => inspectTx(tx, { feePayer: W, allowedPrograms: PROGS }), /lookup tables were not resolved/);
  assert.throws(() => inspectTx(tx, { feePayer: W, allowedPrograms: PROGS, loaded: { writable: [], readonly: [] } }), /lookup tables were not resolved/);
  inspectTx(tx, { feePayer: W, allowedPrograms: PROGS, loaded: { writable: [pool.toBase58()], readonly: [] } });
});

test("ALT: a SOL transfer whose recipient lives in a lookup table is checked against the RESOLVED address", async () => {
  const key = Keypair.generate().publicKey;
  const wsol = new PublicKey(wsolAccount(W));
  const attacker = Keypair.generate().publicKey;
  // The builder claims index 0 is the wallet's WSOL account; on chain it is the attacker.
  const tx = v0([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wsol, lamports: 1e9 })], [table(key, [wsol])]);
  const honest = await resolveLookups(rpc(new Map([[key.toBase58(), [wsol]]])), tx, createLookupCache());
  inspectTx(tx, { feePayer: W, allowedPrograms: PROGS, allowedTransferTo: [wsol.toBase58()], loaded: honest });
  const lied = await resolveLookups(rpc(new Map([[key.toBase58(), [attacker]]])), tx, createLookupCache());
  assert.throws(() => inspectTx(tx, { feePayer: W, allowedPrograms: PROGS, allowedTransferTo: [wsol.toBase58()], loaded: lied }), new RegExp(`SOL transfer to ${attacker.toBase58()}`));
});

test("ALT: the own token's account reached through a lookup table is still locked", async () => {
  const key = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const ownAta = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID);
  const tx = v0([jupIx([ownAta])], [table(key, [ownAta])]);
  const loaded = await resolveLookups(rpc(new Map([[key.toBase58(), [ownAta]]])), tx, createLookupCache());
  assert.deepEqual(loaded, { writable: [ownAta.toBase58()], readonly: [] });
  assert.throws(() => inspectTx(tx, { feePayer: W, allowedPrograms: PROGS, lockedMints: [mint.toBase58()], loaded }), /own token is locked/);
  // A burn of it (the one allowed touch) still passes.
  const burn = v0([createBurnCheckedInstruction(ownAta, mint, wallet, 1n, 6, [], TOKEN_2022_PROGRAM_ID)], [table(key, [ownAta])]);
  inspectTx(burn, { feePayer: W, allowedPrograms: PROGS, lockedMints: [mint.toBase58()], loaded: await resolveLookups(rpc(new Map([[key.toBase58(), [ownAta]]])), burn, createLookupCache()) });
});

test("ALT: fails closed on a missing table or an index past its end", async () => {
  const key = Keypair.generate().publicKey;
  const a = Keypair.generate().publicKey;
  const b = Keypair.generate().publicKey;
  const tx = v0([jupIx([a, b])], [table(key, [a, b])]);
  await assert.rejects(resolveLookups(rpc(new Map()), tx, createLookupCache()), /lookup table .* not found/);
  await assert.rejects(resolveLookups(rpc(new Map([[key.toBase58(), [a]]])), tx, createLookupCache()), /index 1 is past the end/);
  const broken: LookupRpc = { getAddressLookupTable: async () => { throw new Error("429"); } };
  await assert.rejects(resolveLookups(broken, tx, createLookupCache()), /could not read lookup table/);
});

test("ALT: tables are cached (append-only), and re-read when an index is beyond what was cached", async () => {
  const key = Keypair.generate().publicKey;
  const a = Keypair.generate().publicKey;
  const b = Keypair.generate().publicKey;
  const onChain = new Map([[key.toBase58(), [a]]]);
  const r = rpc(onChain);
  const cache = createLookupCache();
  const first = v0([jupIx([a])], [table(key, [a])]);
  await resolveLookups(r, first, cache);
  await resolveLookups(r, first, cache);
  assert.equal(r.calls.length, 1);
  onChain.set(key.toBase58(), [a, b]); // the table was extended
  const second = v0([jupIx([a, b])], [table(key, [a, b])]);
  assert.deepEqual(await resolveLookups(r, second, cache), { writable: [a.toBase58(), b.toBase58()], readonly: [] });
  assert.equal(r.calls.length, 2);
});

test("ALT: a tx without lookups needs no RPC", async () => {
  const r = rpc(new Map());
  const tx = v0([jupIx([Keypair.generate().publicKey])], []);
  assert.deepEqual(await resolveLookups(r, tx, createLookupCache()), { writable: [], readonly: [] });
  assert.equal(r.calls.length, 0);
});
