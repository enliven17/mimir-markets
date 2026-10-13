// Dev tokens are locked: an agent wallet may buy and burn its own token, never sell or move it.
// Enforced at every layer: executor.sell refuses, inspectTx refuses txs that touch the own mint
// outside a burn, and the simulation guard refuses any tx that would lower the own-token balance.
// Also: batch SOL payouts (holder airdrops) and the per-round Privy policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { createBurnCheckedInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { createExecutor } from "../../lib/launch/solana/executor";
import { createJupiter } from "../../lib/launch/solana/jupiter";
import { lockOwnMint } from "../../lib/launch/solana/locks";
import { agentWalletPolicy, ALLOWED_PROGRAMS, PROGRAMS, wsolAccount } from "../../lib/launch/solana/policy";
import { createPrivy } from "../../lib/launch/solana/privy";
import { createPumpPortal } from "../../lib/launch/solana/pumpportal";
import { createSubmitter } from "../../lib/launch/solana/submit";
import { bytes, fakeConnection, fakePrivy, fastSend, json, recordingFetch, unsignedTx } from "../../lib/launch/solana/testkit";
import { inspectTx } from "../../lib/launch/solana/tx";

const walletKp = Keypair.generate();
const wallet = walletKp.publicKey;
const W = wallet.toBase58();
const OWN = Keypair.generate().publicKey;
const OTHER = Keypair.generate().publicKey;
const ownAta = getAssociatedTokenAddressSync(OWN, wallet, false, TOKEN_2022_PROGRAM_ID);
const PROGS = [...ALLOWED_PROGRAMS, PROGRAMS.system];

const tx = (...ixs: TransactionInstruction[]) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions: ixs }).compileToV0Message());
const swapIx = (mint: PublicKey, ata: PublicKey) =>
  new TransactionInstruction({ programId: new PublicKey(PROGRAMS.pumpPortalRouter), keys: [{ pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: ata, isSigner: false, isWritable: true }], data: Buffer.from([0x33]) });
const check = (t: VersionedTransaction, o: { allowLockedTouch?: boolean } = {}) =>
  inspectTx(t, { feePayer: W, allowedPrograms: PROGS, allowedTransferTo: [wsolAccount(W)], lockedMints: [OWN.toBase58()], ...o });

test("inspectTx: a swap that touches the own mint is refused, whoever built it", () => {
  assert.throws(() => check(tx(swapIx(OWN, ownAta))), /own token/);
  // Only the ATA appears (mint in a lookup table): still refused.
  assert.throws(() => check(tx(swapIx(OTHER, ownAta))), /own token/);
  // Other tokens trade freely.
  check(tx(swapIx(OTHER, getAssociatedTokenAddressSync(OTHER, wallet, false, TOKEN_2022_PROGRAM_ID))));
});

test("inspectTx: burning the own token is allowed; closing or any other token op on it is not", () => {
  check(tx(createBurnCheckedInstruction(ownAta, OWN, wallet, 5n, 6, [], TOKEN_2022_PROGRAM_ID)));
  assert.throws(() => check(tx(createCloseAccountInstruction(ownAta, wallet, wallet, [], TOKEN_2022_PROGRAM_ID))), /own token/);
});

test("inspectTx: a buy (buyback) may touch the own mint only when the caller says so; the simulation guard still runs", () => {
  check(tx(swapIx(OWN, ownAta)), { allowLockedTouch: true });
});

/** Token account bytes with `amount` at offset 64 (SPL layout). */
const tokenAccount = (amount: bigint) => {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(amount, 64);
  return data;
};
const acc = (data: Buffer): AccountInfo<Buffer> => ({ owner: TOKEN_2022_PROGRAM_ID, data, lamports: 2_039_280, executable: false, rentEpoch: 0 });

test("submitter: a tx that would lower the own-token balance never reaches Privy, even when the static check was told to allow it", async () => {
  const conn = fakeConnection({ balance: 10_000_000_000n, accounts: new Map([[ownAta.toBase58(), acc(tokenAccount(1_000n))]]), simulateAccounts: new Map([[ownAta.toBase58(), tokenAccount(400n)]]) });
  const privy = fakePrivy(walletKp);
  const submitter = createSubmitter({ privy, connection: conn, send: fastSend, maxAttempts: 1, lockedMints: () => [OWN.toBase58()] });
  await assert.rejects(
    submitter.run("buy", async () => ({ walletId: "w", wallet: W, unsigned: { tx: tx(swapIx(OWN, ownAta)), allowLockedTouch: true } }), () => null),
    /own token .* would drop by 600/,
  );
  assert.equal(privy.seen.length, 0);
  // A burn of exactly the declared amount passes.
  const burn = tx(createBurnCheckedInstruction(ownAta, OWN, wallet, 600n, 6, [], TOKEN_2022_PROGRAM_ID));
  await submitter.run("burn", async () => ({ walletId: "w", wallet: W, unsigned: { tx: burn, burnLocked: 600n } }), () => null);
  assert.equal(privy.seen.length, 1);
});

// ---------------- executor ----------------

function curveAccount(creator: PublicKey | null) {
  const data = Buffer.alloc(151);
  Buffer.from("17b7f83760d8ac60", "hex").copy(data, 0);
  if (creator) creator.toBuffer().copy(data, 49);
  return { owner: new PublicKey(PROGRAMS.pump), data, lamports: 1, executable: false, rentEpoch: 0 } as AccountInfo<Buffer>;
}
const curvePda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], new PublicKey(PROGRAMS.pump))[0].toBase58();
const mintAcc = () => {
  const data = Buffer.alloc(82);
  data[44] = 6;
  return acc(data);
};

function executorWith(accounts: Map<string, AccountInfo<Buffer>>) {
  const pp = recordingFetch(() => bytes(unsignedTx(wallet, [PROGRAMS.computeBudget, PROGRAMS.pumpPortalRouter]).serialize()));
  const conn = fakeConnection({ balance: 5_000_000_000n, accounts, tokenBalance: 1_000_000n });
  const privy = fakePrivy(walletKp);
  const executor = createExecutor({ privy, connection: conn, pumpportal: createPumpPortal({ fetch: pp.fetch, priorityFeeLamports: 100_000n }), jupiter: createJupiter({ fetch: pp.fetch }), send: fastSend });
  return { executor, pp: pp.calls, privy, conn };
}

test("executor.sell refuses the agent's own mint passed explicitly (from the agent record), before any request", async () => {
  const mint = Keypair.generate().publicKey;
  const { executor, pp, privy } = executorWith(new Map([[curvePda(mint), curveAccount(Keypair.generate().publicKey)], [mint.toBase58(), mintAcc()]]));
  await assert.rejects(executor.sell({ walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, mint: mint.toBase58(), tokens: 10n, slippageBps: 300, ownMint: mint.toBase58() }), /own token is locked/);
  assert.equal(pp.length, 0);
  assert.equal(privy.seen.length, 0);
});

test("H2: a coin someone else launched naming the agent wallet as creator is NOT locked: it can be sold", async () => {
  const fake = Keypair.generate().publicKey;
  const { executor, pp } = executorWith(new Map([[curvePda(fake), curveAccount(wallet)], [fake.toBase58(), mintAcc()]]));
  await executor.sell({ walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, mint: fake.toBase58(), tokens: 10n, slippageBps: 300, ownMint: OWN.toBase58() }).catch((e: Error) => {
    assert.doesNotMatch(e.message, /own token/); // the fake tx has no fill; only the lock matters here
  });
  assert.equal(pp.length, 1, "the sell was built");
});

test("H2: buying a mint whose curve creator is the agent wallet is refused unless it is the agent's own mint (buyback)", async () => {
  const fake = Keypair.generate().publicKey;
  const { executor, pp, privy } = executorWith(new Map([[curvePda(fake), curveAccount(wallet)], [fake.toBase58(), mintAcc()], [curvePda(OWN), curveAccount(wallet)]]));
  await assert.rejects(executor.buy({ walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, mint: fake.toBase58(), lamports: 10_000_000n, slippageBps: 300, ownMint: OWN.toBase58() }), /names this wallet as creator/);
  await assert.rejects(executor.buy({ walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, mint: fake.toBase58(), lamports: 10_000_000n, slippageBps: 300 }), /names this wallet as creator/);
  assert.equal(pp.length, 0);
  assert.equal(privy.seen.length, 0);
  // The buyback of the own mint is allowed through to the builder.
  await executor.buy({ walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, mint: OWN.toBase58(), lamports: 10_000_000n, slippageBps: 300, ownMint: OWN.toBase58() }).catch(() => undefined);
  assert.equal(pp.length, 1);
});

test("executor.sell refuses a mint locked for this wallet even without curve data (registry)", async () => {
  const mint = Keypair.generate().publicKey;
  lockOwnMint(W, mint.toBase58());
  const { executor, pp } = executorWith(new Map([[mint.toBase58(), mintAcc()]]));
  await assert.rejects(executor.sell({ walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, mint: mint.toBase58(), tokens: 10n, slippageBps: 300 }), /own token is locked/);
  assert.equal(pp.length, 0);
});

test("executor.sell of someone else's token still works", async () => {
  const mint = Keypair.generate().publicKey;
  const { executor, pp } = executorWith(new Map([[curvePda(mint), curveAccount(Keypair.generate().publicKey)], [mint.toBase58(), mintAcc()]]));
  await executor.sell({ walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, mint: mint.toBase58(), tokens: 10n, slippageBps: 300 }).catch((e: Error) => {
    assert.doesNotMatch(e.message, /own token/); // the fake tx has no fill; only the lock matters here
  });
  assert.equal(pp.length, 1);
});

test("executor.tokenBalance reads the wallet's balance of a mint", async () => {
  const mint = Keypair.generate().publicKey;
  const { executor } = executorWith(new Map([[mint.toBase58(), mintAcc()]]));
  assert.equal(await executor.tokenBalance(W, mint.toBase58()), 1_000_000n);
});

test("payBatch: one tx of exact transfers; the signature is handed out before broadcast", async () => {
  const to = Array.from({ length: 3 }, () => Keypair.generate().publicKey.toBase58());
  const { executor, conn } = executorWith(new Map());
  const seen: { sig: string; sentBefore: number }[] = [];
  const sig = await executor.payBatch({
    walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, transfers: to.map((t, i) => ({ to: t, lamports: 1_000_000n * BigInt(i + 1) })),
    onSigned: async (s) => void seen.push({ sig: s, sentBefore: conn.counters.send }),
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sig, sig);
  assert.equal(seen[0].sentBefore, 0, "recorded before the first broadcast");
  const sent = conn.sent[0];
  const keys = sent.message.staticAccountKeys.map((k) => k.toBase58());
  const transfers = sent.message.compiledInstructions.filter((ix) => keys[ix.programIdIndex] === PROGRAMS.system);
  assert.deepEqual(transfers.map((ix) => [keys[ix.accountKeyIndexes[1]], Buffer.from(ix.data).readBigUInt64LE(4)]), to.map((t, i) => [t, 1_000_000n * BigInt(i + 1)]));
});

test("payBatch refuses duplicates, self, zero amounts and oversized batches", async () => {
  const { executor } = executorWith(new Map());
  const a = Keypair.generate().publicKey.toBase58();
  const base = { walletId: "tb54eps4z44ed0jepousxi4n", wallet: W, onSigned: async () => undefined };
  await assert.rejects(executor.payBatch({ ...base, transfers: [{ to: a, lamports: 1n }, { to: a, lamports: 1n }] }), /twice/);
  await assert.rejects(executor.payBatch({ ...base, transfers: [{ to: W, lamports: 1n }] }), /self/);
  await assert.rejects(executor.payBatch({ ...base, transfers: [{ to: a, lamports: 0n }] }), /positive/);
  await assert.rejects(executor.payBatch({ ...base, transfers: Array.from({ length: 21 }, () => ({ to: Keypair.generate().publicKey.toBase58(), lamports: 1n })) }), /at most 20/);
});

// ---------------- policy ----------------

test("agent policy: an airdrop round adds one rule for exactly its recipients; without one the policy is unchanged", () => {
  const creator = Keypair.generate().publicKey.toBase58();
  const treasury = Keypair.generate().publicKey.toBase58();
  const holders = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
  const plain = agentWalletPolicy({ wallet: W, creator, treasury });
  assert.equal(plain.rules.length, 6);
  const round = agentWalletPolicy({ wallet: W, creator, treasury, airdrop: holders });
  assert.equal(round.rules.length, 8);
  const extra = round.rules.filter((r) => r.name.startsWith("Allow this holder airdrop round"));
  assert.equal(extra.length, 2);
  for (const r of extra) {
    assert.equal(r.action, "ALLOW");
    assert.deepEqual(r.conditions, [
      { field_source: "solana_system_program_instruction", field: "instructionName", operator: "eq", value: "Transfer" },
      { field_source: "solana_system_program_instruction", field: "Transfer.to", operator: "in", value: holders },
    ]);
  }
  // The base allow-list is untouched by a round.
  assert.deepEqual(round.rules[1].conditions[1].value, [treasury, creator, wsolAccount(W)]);
  assert.throws(() => agentWalletPolicy({ wallet: W, creator, treasury, airdrop: ["0xnope"] }), /base58/);
});

test("privy: reads a wallet's policy ids and replaces a policy's rules (signed PATCH)", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rec = recordingFetch((c) => (c.init.method === "GET" ? json({ id: "tb54eps4z44ed0jepousxi4n", address: W, policy_ids: ["pol123456789"] }) : json({ id: "pol123456789" })));
  const privy = createPrivy({ appId: "app", appSecret: "secret", authKey: `wallet-auth:${privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")}`, fetch: rec.fetch });
  assert.deepEqual(await privy.walletPolicyIds("tb54eps4z44ed0jepousxi4n"), ["pol123456789"]);
  assert.equal(rec.calls[0].url, "https://api.privy.io/v1/wallets/tb54eps4z44ed0jepousxi4n");
  const policy = agentWalletPolicy({ wallet: W, creator: Keypair.generate().publicKey.toBase58(), treasury: Keypair.generate().publicKey.toBase58() });
  await privy.updatePolicy("pol123456789", policy);
  const c = rec.calls[1];
  assert.equal(c.url, "https://api.privy.io/v1/policies/pol123456789");
  assert.equal(c.init.method, "PATCH");
  assert.deepEqual(c.body, { name: policy.name, rules: policy.rules });
  assert.ok((c.init.headers as Record<string, string>)["privy-authorization-signature"]);
  await assert.rejects(privy.updatePolicy("../evil", policy), /policyId/);
});

test("SystemProgram transfer helper stays a plain Transfer (instruction 2) for the batch decoder", () => {
  const ix = SystemProgram.transfer({ fromPubkey: wallet, toPubkey: OTHER, lamports: 5 });
  assert.equal(ix.data.readUInt32LE(0), 2);
});
