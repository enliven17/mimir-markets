import test from "node:test";
import assert from "node:assert/strict";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { FLASH_PERP_PROGRAM_IDS, planHedgeFromSpec, verifyHedgeTx } from "../../lib/solana/flashtrade";

const owner = Keypair.generate().publicKey;
const flash = new PublicKey(FLASH_PERP_PROGRAM_IDS[0]);
const tx = (payer: PublicKey, ixs: TransactionInstruction[]) =>
  new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message(),
  );
const flashIx = new TransactionInstruction({ programId: flash, keys: [{ pubkey: owner, isSigner: true, isWritable: true }], data: Buffer.from([1]) });

test("a Flash-built hedge tx is signed only when payer and programs check out", () => {
  assert.deepEqual(verifyHedgeTx(tx(owner, [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), flashIx]), owner), { ok: true });
  const drain = SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1 });
  assert.equal(verifyHedgeTx(tx(owner, [flashIx, drain]), owner).ok, false, "a System transfer rides along: refused");
  assert.equal(verifyHedgeTx(tx(Keypair.generate().publicKey, [flashIx]), owner).ok, false, "someone else pays");
  assert.equal(verifyHedgeTx(tx(owner, []), owner).ok, false);
});

test("hedge direction comes from the resolver spec, not the wording", () => {
  // The challenger staked "No" on "BTC > X": it wins if the condition is NOT met → short exposure → hedge LONG.
  assert.equal(planHedgeFromSpec({ spec: { symbol: "BTC", op: ">" }, stakedSideWinsIfMet: false, stakeUsd: 10 })?.tradeType, "LONG");
  const yes = planHedgeFromSpec({ spec: { symbol: "BTC", op: ">" }, stakedSideWinsIfMet: true, stakeUsd: 10 });
  assert.equal(yes?.tradeType, "SHORT");
  assert.equal(yes?.collateralUsd, 5);
  assert.equal(planHedgeFromSpec({ spec: { symbol: "SOL", op: "<" }, stakedSideWinsIfMet: true, stakeUsd: 10 })?.tradeType, "LONG");
  assert.equal(planHedgeFromSpec({ spec: { symbol: "ANSEM", op: ">" }, stakedSideWinsIfMet: true, stakeUsd: 10 }), null, "not on Flash");
});

test("a hedge tx with two Flash instructions, a huge priority fee, or an ATA for another wallet is refused", () => {
  assert.equal(verifyHedgeTx(tx(owner, [flashIx, flashIx]), owner).ok, false, "two positions");
  assert.equal(
    verifyHedgeTx(tx(owner, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000_000 }), flashIx]), owner).ok,
    false,
    "priority fee drain",
  );
  assert.equal(verifyHedgeTx(tx(owner, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), flashIx]), owner).ok, true);
  const ata = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const ataIx = (wallet: PublicKey) =>
    new TransactionInstruction({
      programId: ata,
      keys: [owner, Keypair.generate().publicKey, wallet, Keypair.generate().publicKey].map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: i < 2 })),
      data: Buffer.from([1]),
    });
  assert.equal(verifyHedgeTx(tx(owner, [ataIx(owner), flashIx]), owner).ok, true);
  assert.equal(verifyHedgeTx(tx(owner, [ataIx(Keypair.generate().publicKey), flashIx]), owner).ok, false, "rent for someone else's ATA");
});
