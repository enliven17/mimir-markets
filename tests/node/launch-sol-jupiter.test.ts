import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createJupiter, WSOL_MINT } from "../../lib/launch/solana/jupiter";
import { PROGRAMS, wsolAccount } from "../../lib/launch/solana/policy";
import { json, recordingFetch } from "../../lib/launch/solana/testkit";

const TAKER = "DoyrVvzR2vwurz23Kkk5Z4QVeXLjs6nUfsSsnghidS8";
const MINT = "yKGGjQCLr8rSz1eBCVeKBoxDjRxgJiBqs2Duj47pump";
const ALT = Keypair.generate().publicKey.toBase58();
const POOL = Keypair.generate().publicKey.toBase58();
const acc = (pubkey: string, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const ix = (programId: string, accounts: ReturnType<typeof acc>[], data: number[]) => ({ programId, accounts, data: Buffer.from(data).toString("base64") });

/** Same shape and instruction set as a live /swap/v2/build response for a PumpSwap coin (2026-10-05). */
function buildBody(over: Record<string, unknown> = {}) {
  const price = Buffer.alloc(9);
  price[0] = 3;
  price.writeBigUInt64LE(BigInt(8120), 1);
  return {
    inputMint: WSOL_MINT,
    outputMint: MINT,
    inAmount: "10000000",
    outAmount: "2337863",
    otherAmountThreshold: "2267728",
    swapMode: "ExactIn",
    slippageBps: 300,
    priceImpactPct: "0.001",
    routePlan: [{ percent: 100, bps: 10000, swapInfo: { ammKey: POOL, label: "Pump.fun Amm", inputMint: WSOL_MINT, outputMint: MINT, inAmount: "10000000", outAmount: "2337863" } }],
    computeBudgetInstructions: [{ programId: ComputeBudgetProgram.programId.toBase58(), accounts: [], data: price.toString("base64") }],
    setupInstructions: [
      ix(PROGRAMS.associatedToken, [acc(TAKER, true, true), acc(wsolAccount(TAKER), false, true), acc(TAKER), acc(WSOL_MINT), acc(PROGRAMS.system), acc(PROGRAMS.token)], [1]),
      ix(PROGRAMS.system, [acc(TAKER, true, true), acc(wsolAccount(TAKER), false, true)], [2, 0, 0, 0, 0x80, 0x96, 0x98, 0, 0, 0, 0, 0]),
      ix(PROGRAMS.token, [acc(wsolAccount(TAKER), false, true)], [17]),
    ],
    swapInstruction: ix(PROGRAMS.jupiter, [acc(TAKER, true), acc(wsolAccount(TAKER), false, true), acc(MINT), acc(POOL, false, true), acc(PROGRAMS.pumpAmm)], [0xbb, 0x64]),
    cleanupInstruction: ix(PROGRAMS.token, [acc(wsolAccount(TAKER), false, true), acc(TAKER, false, true), acc(TAKER, true)], [9]),
    otherInstructions: [],
    tipInstruction: null,
    addressesByLookupTableAddress: { [ALT]: [PROGRAMS.pumpAmm, POOL] },
    blockhashWithMetadata: { blockhash: Array.from({ length: 32 }, (_, i) => i + 1), lastValidBlockHeight: 431672330 },
    transactionVersion: "V0",
    ...over,
  };
}

test("quote: GET /swap/v2/build with taker, slippage, CU percentile and x-api-key", async () => {
  const rec = recordingFetch(() => json(buildBody()));
  const jup = createJupiter({ fetch: rec.fetch, apiKey: "jup-key", cuPricePercentile: "high" });
  const b = await jup.quote({ inputMint: WSOL_MINT, outputMint: MINT, amount: BigInt(10_000_000), taker: TAKER, slippageBps: 300 });
  const url = new URL(rec.calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, "https://api.jup.ag/swap/v2/build");
  assert.deepEqual(Object.fromEntries(url.searchParams), { inputMint: WSOL_MINT, outputMint: MINT, amount: "10000000", taker: TAKER, slippageBps: "300", computeUnitPricePercentile: "high" });
  assert.equal(rec.calls[0].init.method, "GET");
  assert.equal((rec.calls[0].init.headers as Record<string, string>)["x-api-key"], "jup-key");
  assert.equal(b.otherAmountThreshold, "2267728");
});

test("quote rejects a response for a different amount/mint and surfaces HTTP errors", async () => {
  const jup = createJupiter({ fetch: recordingFetch(() => json(buildBody({ inAmount: "999" }))).fetch });
  await assert.rejects(jup.quote({ inputMint: WSOL_MINT, outputMint: MINT, amount: BigInt(10_000_000), taker: TAKER, slippageBps: 300 }), /does not match/);
  const err = createJupiter({ fetch: recordingFetch(() => json({ error: "no route" }, 400)).fetch, apiKey: "jup-key" });
  await assert.rejects(err.quote({ inputMint: WSOL_MINT, outputMint: MINT, amount: BigInt(1), taker: TAKER, slippageBps: 300 }), (e: Error & { status: number }) => e.status === 400 && /^jupiter: build -> 400/.test(e.message));
});

test("swapTx: v0 tx with taker as payer, given blockhash, CU limit, capped priority fee, ALT compression", async () => {
  const jup = createJupiter({ fetch: recordingFetch(() => json(buildBody())).fetch });
  const b = await jup.quote({ inputMint: WSOL_MINT, outputMint: MINT, amount: BigInt(10_000_000), taker: TAKER, slippageBps: 300 });
  const { tx, lastValidBlockHeight } = jup.swapTx(b, { cuLimit: 120_000, maxPriorityFeeLamports: BigInt(1_000_000) });
  const m = tx.message;
  assert.equal(lastValidBlockHeight, 431672330);
  assert.equal(m.staticAccountKeys[0].toBase58(), TAKER);
  assert.equal(m.recentBlockhash, bs58.encode(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1))));
  assert.equal(m.addressTableLookups.length, 1);
  assert.equal(m.addressTableLookups[0].accountKey.toBase58(), ALT);
  const programs = m.compiledInstructions.map((c) => m.staticAccountKeys[c.programIdIndex].toBase58());
  assert.deepEqual(programs, [PROGRAMS.computeBudget, PROGRAMS.computeBudget, PROGRAMS.associatedToken, PROGRAMS.system, PROGRAMS.token, PROGRAMS.jupiter, PROGRAMS.token]);
  const [limit, price] = m.compiledInstructions.slice(0, 2).map((c) => Buffer.from(c.data));
  assert.equal(limit.readUInt32LE(1), 120_000);
  assert.equal(price.readBigUInt64LE(1), BigInt(8120)); // under the cap: Jupiter's price kept
  // WSOL ATA (System Transfer target) must be a static key so the Privy policy can read Transfer.to.
  assert.ok(m.staticAccountKeys.some((k) => k.toBase58() === wsolAccount(TAKER)));

  const capped = jup.swapTx(b, { cuLimit: 200_000, maxPriorityFeeLamports: BigInt(1_000) });
  assert.equal(Buffer.from(capped.tx.message.compiledInstructions[1].data).readBigUInt64LE(1), BigInt(5_000)); // 1000 lamports * 1e6 / 200k CU
});
