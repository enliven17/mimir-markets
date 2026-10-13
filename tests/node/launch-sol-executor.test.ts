import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, Keypair, PublicKey, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { createExecutor } from "../../lib/launch/solana/executor";
import { createJupiter, WSOL_MINT } from "../../lib/launch/solana/jupiter";
import { PROGRAMS } from "../../lib/launch/solana/policy";
import { createPumpPortal } from "../../lib/launch/solana/pumpportal";
import { bytes, fakeConnection, fakePrivy, fastSend, json, recordingFetch, unsignedTx, type Effect } from "../../lib/launch/solana/testkit";
import { AmbiguousSendError, SolanaError, TxFailedError } from "../../lib/launch/solana/util";

const walletKp = Keypair.generate();
const W = walletKp.publicKey.toBase58();
const WALLET_ID = "tb54eps4z44ed0jepousxi4n";
const CURVE_MINT = Keypair.generate().publicKey.toBase58();
const MIGRATED_MINT = Keypair.generate().publicKey.toBase58();
const PLAIN_MINT = Keypair.generate().publicKey.toBase58();

function account(owner: string, data: Buffer): AccountInfo<Buffer> {
  return { owner: new PublicKey(owner), data, lamports: 1_461_600, executable: false, rentEpoch: 0 };
}
function curveAccount(complete: boolean) {
  const data = Buffer.alloc(151);
  Buffer.from("17b7f83760d8ac60", "hex").copy(data, 0);
  data[48] = complete ? 1 : 0;
  return account(PROGRAMS.pump, data);
}
const curvePda = (mint: string) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PROGRAMS.pump))[0].toBase58();
const mintAccount = () => {
  const data = Buffer.alloc(82);
  data[44] = 6;
  return account(PROGRAMS.token2022, data);
};
const accounts = new Map<string, AccountInfo<Buffer>>([
  [curvePda(CURVE_MINT), curveAccount(false)],
  [curvePda(MIGRATED_MINT), curveAccount(true)],
  [CURVE_MINT, mintAccount()],
  [MIGRATED_MINT, mintAccount()],
]);

const ppTx = (extra: PublicKey[] = []) => unsignedTx(walletKp.publicKey, [PROGRAMS.computeBudget, PROGRAMS.associatedToken, PROGRAMS.pumpPortalRouter], extra).serialize();
let jupThreshold = "1";
let jupAlt: Record<string, string[]> = {};
/** Extra (non-signer) accounts on the swap instruction, e.g. a pool that lives in a lookup table. */
let jupExtra: string[] = [];
function jupBuild(input: string, output: string, amount: string) {
  const price = Buffer.alloc(9);
  price[0] = 3;
  price.writeBigUInt64LE(BigInt(10_000), 1);
  const ix = (programId: string) => ({ programId, accounts: [{ pubkey: W, isSigner: true, isWritable: true }], data: "AQ==" });
  return {
    inputMint: input, outputMint: output, inAmount: amount, outAmount: jupThreshold, otherAmountThreshold: jupThreshold,
    computeBudgetInstructions: [{ programId: ComputeBudgetProgram.programId.toBase58(), accounts: [], data: price.toString("base64") }],
    setupInstructions: [ix(PROGRAMS.associatedToken)], swapInstruction: { ...ix(PROGRAMS.jupiter), accounts: [...ix(PROGRAMS.jupiter).accounts, ...jupExtra.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }))] }, cleanupInstruction: ix(PROGRAMS.token),
    otherInstructions: [], tipInstruction: null, addressesByLookupTableAddress: jupAlt,
    blockhashWithMetadata: { blockhash: Array.from({ length: 32 }, () => 5), lastValidBlockHeight: 1_000 },
  };
}

const buyEffect = (mint: string): Effect => ({ sol: BigInt(-102_089_080), token: { mint, owner: W, decimals: 6, pre: BigInt(0), post: BigInt(3_456_789_012_345) } });

function setup(o: Parameters<typeof fakeConnection>[0] = {}, privyFail?: () => Error | null, witness?: ReturnType<typeof fakeConnection>) {
  const pp = recordingFetch((c) => (c.url.includes("pinata") ? json({ data: { cid: "bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra" } }) : bytes(ppTx((c.body as { mint?: string }).mint && (c.body as { action: string }).action === "create" ? [new PublicKey((c.body as { mint: string }).mint)] : []))));
  const jup = recordingFetch((c) => {
    const q = new URL(c.url).searchParams;
    return json(jupBuild(q.get("inputMint")!, q.get("outputMint")!, q.get("amount")!));
  });
  const connection = fakeConnection({ balance: BigInt(5_000_000_000), accounts, tokenBalance: BigInt(1_000_000), ...o });
  const privy = fakePrivy(walletKp, { fail: privyFail });
  const executor = createExecutor({
    privy,
    connection,
    pumpportal: createPumpPortal({ fetch: pp.fetch, pinataJwt: "jwt", priorityFeeLamports: BigInt(100_000) }),
    jupiter: createJupiter({ fetch: jup.fetch }),
    send: fastSend,
    ...(witness ? { endpoints: { pickEndpoint: () => ({ url: "a", connection, witnesses: [witness] }) } } : {}),
  });
  return { executor, connection, privy, pp: pp.calls, jup: jup.calls };
}
const programsOf = (tx: VersionedTransaction) => tx.message.compiledInstructions.map((c) => tx.message.staticAccountKeys[c.programIdIndex].toBase58());

test("routing: live curve -> PumpPortal, complete curve or non-pump -> Jupiter", async () => {
  const { executor } = setup();
  assert.equal(await executor.route(CURVE_MINT), "curve");
  assert.equal(await executor.route(MIGRATED_MINT), "jupiter");
  assert.equal(await executor.route(PLAIN_MINT), "jupiter");
});

test("buy on the curve: PumpPortal pool=pump, Privy signs, fill measured from the confirmed tx", async () => {
  const s = setup({ effect: buyEffect(CURVE_MINT) });
  const fill = await s.executor.buy({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, lamports: BigInt(100_000_000), slippageBps: 1000 });
  assert.equal(s.jup.length, 0);
  assert.deepEqual(s.pp[0].body, { publicKey: W, action: "buy", mint: CURVE_MINT, amount: 0.1, denominatedInSol: "true", slippage: 10, priorityFee: 0.0001, pool: "pump" });
  assert.deepEqual(fill, { sig: bs58.encode(s.connection.sent[0].signatures[0]), lamports: BigInt(102_089_080), tokens: BigInt(3_456_789_012_345), decimals: 6 });
  assert.equal(s.privy.seen.length, 1);
});

test("buy after migration: Jupiter build, simulated CU limit (1.2x), never PumpPortal", async () => {
  const s = setup({ effect: buyEffect(MIGRATED_MINT), simulateUnits: 100_000 });
  await s.executor.buy({ walletId: WALLET_ID, wallet: W, mint: MIGRATED_MINT, lamports: BigInt(100_000_000), slippageBps: 300 });
  assert.equal(s.pp.length, 0);
  const q = new URL(s.jup[0].url).searchParams;
  assert.deepEqual([q.get("inputMint"), q.get("outputMint"), q.get("amount"), q.get("taker")], [WSOL_MINT, MIGRATED_MINT, "100000000", W]);
  const sent = s.connection.sent[0];
  assert.ok(programsOf(sent).includes(PROGRAMS.jupiter));
  assert.equal(Buffer.from(sent.message.compiledInstructions[0].data).readUInt32LE(1), 120_000);
});

test("sell: whole balance on the curve sends 100%; Jupiter sells at most what is held", async () => {
  const sellEffect = (mint: string): Effect => ({ sol: BigInt(90_000_000), token: { mint, owner: W, decimals: 6, pre: BigInt(1_000_000), post: BigInt(0) } });
  const a = setup({ effect: sellEffect(CURVE_MINT) });
  const fill = await a.executor.sell({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, tokens: BigInt(5_000_000), slippageBps: 500 });
  assert.equal((a.pp[0].body as { amount: string }).amount, "100%");
  assert.deepEqual([fill.lamports, fill.tokens], [BigInt(90_000_000), BigInt(1_000_000)]);
  const b = setup({ effect: sellEffect(MIGRATED_MINT) });
  await b.executor.sell({ walletId: WALLET_ID, wallet: W, mint: MIGRATED_MINT, tokens: BigInt(5_000_000), slippageBps: 500 });
  assert.equal(new URL(b.jup[0].url).searchParams.get("amount"), "1000000");
});

test("ambiguous send: never re-signs or rebuilds, only rebroadcasts the same bytes", async () => {
  const s = setup({ sendError: () => new Error("fetch failed: ECONNRESET"), status: () => null, blockHeight: () => 10 });
  await assert.rejects(s.executor.buy({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, lamports: BigInt(100_000_000), slippageBps: 1000 }), AmbiguousSendError);
  assert.equal(s.pp.length, 1, "built once");
  assert.equal(s.privy.seen.length, 1, "signed once");
  assert.equal(new Set(s.connection.sent.map((t) => bs58.encode(t.signatures[0]))).size, 1, "one signature on the wire");
});

test("provably expired attempt (sticky endpoint past the margin AND a second endpoint has no record) is rebuilt and retried", async () => {
  let first: string | null = null;
  const s = setup({
    effect: buyEffect(CURVE_MINT),
    status: (sig) => {
      first ??= sig;
      return sig === first ? null : "confirmed";
    },
    blockHeight: () => 2_000,
  }, undefined, fakeConnection({ status: () => null, blockHeight: () => 2_000 }));
  const fill = await s.executor.buy({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, lamports: BigInt(100_000_000), slippageBps: 1000 });
  assert.equal(s.pp.length, 2);
  assert.equal(s.privy.seen.length, 2);
  assert.notEqual(fill.sig, first);
});

test("no retry when the tx landed with an error or Privy rejects by policy", async () => {
  const failed = setup({ status: () => ({ err: { InstructionError: [2, { Custom: 6002 }] } }) });
  await assert.rejects(failed.executor.buy({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, lamports: BigInt(100_000_000), slippageBps: 1000 }), TxFailedError);
  assert.equal(failed.pp.length, 1);
  const policy = setup({}, () => new SolanaError("privy", "POST /rpc -> 403: policy", { status: 403, code: "POLICY_VIOLATION" }));
  await assert.rejects(policy.executor.buy({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, lamports: BigInt(100_000_000), slippageBps: 1000 }), /403/);
  assert.equal(policy.pp.length, 1);
  assert.equal(policy.connection.sent.length, 0);
});

test("spendable keeps a 0.01 SOL reserve; buys above it are refused before any request", async () => {
  assert.equal(await setup({ balance: BigInt(50_000_000) }).executor.spendable(W), BigInt(40_000_000));
  assert.equal(await setup({ balance: BigInt(5_000_000) }).executor.spendable(W), BigInt(0));
  const s = setup({ balance: BigInt(50_000_000) });
  await assert.rejects(s.executor.buy({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, lamports: BigInt(40_000_001), slippageBps: 100 }), /exceeds spendable/);
  assert.equal(s.pp.length + s.jup.length, 0);
});

test("launchToken: mint keypair signs first, then Privy signs as creator; both signatures verified", async () => {
  const s = setup({ effect: (tx) => buyEffect(tx.message.staticAccountKeys[1].toBase58()) });
  const png = `data:image/png;base64,${Buffer.from("img").toString("base64")}`;
  const out = await s.executor.launchToken({ walletId: WALLET_ID, wallet: W, name: "Agent", symbol: "AGT", description: "d", imageDataUrl: png, devBuyLamports: BigInt(100_000_000) });
  const create = s.pp.find((c) => (c.body as { action?: string }).action === "create")!.body as { mint: string; publicKey: string };
  assert.equal(out.mint, create.mint);
  assert.equal(create.publicKey, W);
  const toPrivy = s.privy.seen[0];
  assert.equal(toPrivy.message.staticAccountKeys[1].toBase58(), out.mint);
  assert.ok(toPrivy.signatures[1].some((b) => b !== 0), "mint signature present before Privy");
  assert.ok(toPrivy.signatures[0].every((b) => b === 0), "creator not yet signed");
  const sent = s.connection.sent[0];
  assert.ok(sent.signatures.every((sig) => sig.some((b) => b !== 0)));
  assert.equal(out.sig, bs58.encode(sent.signatures[0]));
  assert.match(out.metadataUri, /^https:\/\/ipfs\.io\/ipfs\/bafy/);
  assert.equal(out.devBuy?.tokens, BigInt(3_456_789_012_345));
});

test("burn and transferSol build local txs (BurnChecked on Token-2022, System transfer)", async () => {
  const s = setup();
  await s.executor.burn({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, tokens: BigInt(1_000) });
  assert.deepEqual(programsOf(s.connection.sent[0]), [PROGRAMS.computeBudget, PROGRAMS.computeBudget, PROGRAMS.token2022]);
  assert.equal(Buffer.from(s.connection.sent[0].message.compiledInstructions[2].data)[0], 15); // BurnChecked
  const to = Keypair.generate().publicKey.toBase58();
  await s.executor.transferSol({ walletId: WALLET_ID, wallet: W, to, lamports: BigInt(1_000_000) });
  assert.deepEqual(programsOf(s.connection.sent[1]), [PROGRAMS.computeBudget, PROGRAMS.computeBudget, PROGRAMS.system]);
  await assert.rejects(s.executor.transferSol({ walletId: WALLET_ID, wallet: W, to: W, lamports: BigInt(1) }), /to self/);
  await assert.rejects(s.executor.burn({ walletId: WALLET_ID, wallet: W, mint: CURVE_MINT, tokens: BigInt(2_000_000) }), /exceeds token balance/);
});

test("claimCreatorFees returns the net SOL gained", async () => {
  const s = setup({ effect: { sol: BigInt(42_000_000) } });
  const out = await s.executor.claimCreatorFees({ walletId: WALLET_ID, wallet: W });
  assert.deepEqual(s.pp[0].body, { publicKey: W, action: "collectCreatorFee", priorityFee: 0.0001 });
  assert.equal(out.lamports, BigInt(42_000_000));
});

test("M5: a Jupiter sell must bring back at least the quote's otherAmountThreshold (less a fee allowance)", async () => {
  jupThreshold = "500000000";
  try {
    const s = setup({ simulateSolOut: -BigInt(100_000_000) }); // the simulated sell only returns 0.1 SOL
    await assert.rejects(s.executor.sell({ walletId: WALLET_ID, wallet: W, mint: MIGRATED_MINT, tokens: BigInt(1_000_000), slippageBps: 300 }), /would receive 100000000 lamports, minimum 495000000/);
    assert.equal(s.privy.seen.length, 0);
  } finally {
    jupThreshold = "1";
  }
});

test("M5: a curve sell must bring back the curve's price for the tokens less slippage and fees", async () => {
  const mint = Keypair.generate().publicKey.toBase58();
  const data = Buffer.alloc(151);
  Buffer.from("17b7f83760d8ac60", "hex").copy(data, 0);
  data.writeBigUInt64LE(BigInt(1_000_000_000_000), 8); // virtual token reserves
  data.writeBigUInt64LE(BigInt(30_000_000_000), 16); // virtual SOL reserves
  const s = setup({ simulateSolOut: -BigInt(100_000_000), tokenBalance: BigInt(10_000_000_000), accounts: new Map([...accounts, [curvePda(mint), account(PROGRAMS.pump, data)], [mint, mintAccount()]]) });
  // 1e10 of (1e12 + 1e10) virtual tokens against 30 SOL: 297_029_702 lamports, x (1 - 5% - 3%) = 273_267_325, less 0.005 SOL.
  await assert.rejects(s.executor.sell({ walletId: WALLET_ID, wallet: W, mint, tokens: BigInt(10_000_000_000), slippageBps: 500 }), /would receive 100000000 lamports, minimum 268267325/);
  assert.equal(s.privy.seen.length, 0);
});

// ---- user trades (the member's own wallet signs): ALT-resolved inspection + simulated deltas ----

/** An SPL token account's data with `amount` at byte 64. */
const tokenAcc = (amount: bigint) => {
  const d = Buffer.alloc(165);
  d.writeBigUInt64LE(amount, 64);
  return d;
};
const userAta = (mint: string) => getAssociatedTokenAddressSync(new PublicKey(mint), walletKp.publicKey, false, TOKEN_2022_PROGRAM_ID).toBase58();

test("user trade: a Jupiter buy is returned unsigned only when the simulation gives at least the quote's minimum tokens", async () => {
  jupThreshold = "1000";
  try {
    const short = setup({ simulateAccounts: new Map([[userAta(MIGRATED_MINT), tokenAcc(10n)]]) });
    await assert.rejects(short.executor.buildUserTrade({ wallet: W, mint: MIGRATED_MINT, side: "buy", amount: 100_000_000n, slippageBps: 300 }), /would receive 10 .*minimum 1000/);
    const ok = setup({ simulateAccounts: new Map([[userAta(MIGRATED_MINT), tokenAcc(5_000n)]]) });
    const b64 = await ok.executor.buildUserTrade({ wallet: W, mint: MIGRATED_MINT, side: "buy", amount: 100_000_000n, slippageBps: 300 });
    const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    assert.equal(tx.message.staticAccountKeys[0].toBase58(), W);
    assert.ok(tx.signatures[0].every((b) => b === 0), "never signed by us");
  } finally {
    jupThreshold = "1";
  }
});

test("user trade: a buy that would take more SOL than the amount plus fees is refused", async () => {
  const s = setup({ simulateSolOut: 1_000_000_000n, simulateAccounts: new Map([[userAta(CURVE_MINT), tokenAcc(1n)]]) });
  await assert.rejects(s.executor.buildUserTrade({ wallet: W, mint: CURVE_MINT, side: "buy", amount: 100_000_000n, slippageBps: 300 }), /would take 1000000000 lamports out of the wallet/);
});

test("user trade: a sell must bring back the quote's minimum and spend no more than the amount", async () => {
  jupThreshold = "500000000";
  try {
    const low = setup({ simulateSolOut: -100_000_000n, simulateAccounts: new Map([[userAta(MIGRATED_MINT), tokenAcc(0n)]]), tokenBalance: 1_000_000n, accounts: new Map([...accounts, [userAta(MIGRATED_MINT), account(PROGRAMS.token2022, tokenAcc(1_000_000n))]]) });
    await assert.rejects(low.executor.buildUserTrade({ wallet: W, mint: MIGRATED_MINT, side: "sell", amount: 1_000_000n, slippageBps: 300 }), /would receive 100000000 lamports, minimum 495000000/);
    const over = setup({ simulateSolOut: -600_000_000n, simulateAccounts: new Map([[userAta(MIGRATED_MINT), tokenAcc(0n)]]), accounts: new Map([...accounts, [userAta(MIGRATED_MINT), account(PROGRAMS.token2022, tokenAcc(5_000_000n))]]) });
    await assert.rejects(over.executor.buildUserTrade({ wallet: W, mint: MIGRATED_MINT, side: "sell", amount: 1_000_000n, slippageBps: 300 }), /balance would drop by 5000000, allowed 1000000/);
  } finally {
    jupThreshold = "1";
  }
});

test("ALT: lookup accounts are resolved from chain; a table that cannot be read fails closed (user and server paths)", async () => {
  const table = Keypair.generate().publicKey.toBase58();
  const pool = Keypair.generate().publicKey.toBase58();
  jupAlt = { [table]: [pool] };
  jupExtra = [pool];
  try {
    const missing = setup({ effect: buyEffect(MIGRATED_MINT) });
    await assert.rejects(missing.executor.buildUserTrade({ wallet: W, mint: MIGRATED_MINT, side: "buy", amount: 100_000_000n, slippageBps: 300 }), /lookup table .* not found/);
    await assert.rejects(missing.executor.buy({ walletId: WALLET_ID, wallet: W, mint: MIGRATED_MINT, lamports: 100_000_000n, slippageBps: 300 }), /lookup table .* not found/);
    assert.equal(missing.privy.seen.length, 0);
    const found = setup({ effect: buyEffect(MIGRATED_MINT), lookupTables: new Map([[table, [pool]]]) });
    await found.executor.buy({ walletId: WALLET_ID, wallet: W, mint: MIGRATED_MINT, lamports: 100_000_000n, slippageBps: 300 });
    assert.equal(found.connection.sent[0].message.addressTableLookups[0].accountKey.toBase58(), table);
  } finally {
    jupAlt = {};
    jupExtra = [];
  }
});
