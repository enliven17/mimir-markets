import test from "node:test";
import assert from "node:assert/strict";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import idl from "../../lib/solana/idl/mimir.json";
import { verifyPreparedTransaction } from "../../sdk/verify-tx";
import { MimirAgentClient } from "../../sdk/agents";

const PROGRAM = new PublicKey(idl.address);
const operator = Keypair.generate();
const BLOCKHASH = "11111111111111111111111111111111";

function disc(name: string): Buffer {
  const ix = idl.instructions.find((i) => i.name === name)!;
  return Buffer.from(ix.discriminator);
}
function u64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function claimPda(id: bigint, program = PROGRAM): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("claim"), u64(id)], program)[0];
}
function mimirIx(name: string, data: Buffer, keys: PublicKey[], program = PROGRAM): TransactionInstruction {
  return new TransactionInstruction({
    programId: program,
    keys: keys.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: true })),
    data: Buffer.concat([disc(name), data]),
  });
}
function challengeTx(opts: { claimId?: bigint; stake?: bigint; extra?: TransactionInstruction[]; feePayer?: PublicKey } = {}): Transaction {
  const tx = new Transaction({ feePayer: opts.feePayer ?? operator.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  const rnd = Keypair.generate().publicKey;
  tx.add(
    mimirIx("challenge_claim", Buffer.concat([u64(opts.stake ?? 2_000_000n), Buffer.from([0])]), [
      operator.publicKey,
      rnd,
      claimPda(opts.claimId ?? 7n),
      rnd,
    ]),
  );
  for (const ix of opts.extra ?? []) tx.add(ix);
  return tx;
}
const base = { programId: PROGRAM, operator: operator.publicKey };

test("a matching challenge transaction passes", () => {
  verifyPreparedTransaction(challengeTx(), { ...base, expect: { action: "challenge", claimId: 7n, amountUnits: 2_000_000n } });
});

test("a System transfer smuggled into the transaction is refused", () => {
  const drain = SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1e9 });
  assert.throws(
    () => verifyPreparedTransaction(challengeTx({ extra: [drain] }), { ...base, expect: { action: "challenge" } }),
    /program/,
  );
});

test("an SPL token instruction is refused", () => {
  const spl = new TransactionInstruction({
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    keys: [],
    data: Buffer.from([3]),
  });
  assert.throws(() => verifyPreparedTransaction(challengeTx({ extra: [spl] }), { ...base, expect: { action: "challenge" } }), /program/);
});

test("a look-alike program (server-supplied id) is refused", () => {
  const evil = Keypair.generate().publicKey;
  const tx = new Transaction({ feePayer: operator.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  tx.add(mimirIx("challenge_claim", Buffer.concat([u64(2_000_000n), Buffer.from([0])]), [operator.publicKey], evil));
  assert.throws(() => verifyPreparedTransaction(tx, { ...base, expect: { action: "challenge" } }), /program/);
});

test("the instruction must be the requested action", () => {
  assert.throws(() => verifyPreparedTransaction(challengeTx(), { ...base, expect: { action: "deposit" } }), /instruction/);
  const tx = new Transaction({ feePayer: operator.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  tx.add(mimirIx("withdraw", u64(5n), [operator.publicKey]));
  assert.throws(() => verifyPreparedTransaction(tx, { ...base, expect: { action: "challenge" } }), /instruction/);
  // Without an action only agent write instructions pass: an admin one never does.
  const admin = new Transaction({ feePayer: operator.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  admin.add(mimirIx("set_paused", Buffer.from([1]), [operator.publicKey]));
  assert.throws(() => verifyPreparedTransaction(admin, base), /instruction/);
});

test("amount and claim must match the request", () => {
  assert.throws(
    () => verifyPreparedTransaction(challengeTx({ stake: 9_000_000n }), { ...base, expect: { action: "challenge", amountUnits: 2_000_000n } }),
    /amount/,
  );
  assert.throws(
    () => verifyPreparedTransaction(challengeTx({ claimId: 8n }), { ...base, expect: { action: "challenge", claimId: 7n } }),
    /claim/,
  );
});

test("the fee payer must be the operator", () => {
  assert.throws(
    () => verifyPreparedTransaction(challengeTx({ feePayer: Keypair.generate().publicKey }), { ...base, expect: { action: "challenge" } }),
    /fee payer/,
  );
});

test("ComputeBudget is allowed, an absurd priority fee is not", () => {
  const ok = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })];
  verifyPreparedTransaction(challengeTx({ extra: ok }), { ...base, expect: { action: "challenge" } });
  const greedy = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000_000 });
  assert.throws(() => verifyPreparedTransaction(challengeTx({ extra: [greedy] }), { ...base, expect: { action: "challenge" } }), /priority/);
});

test("submit refuses a tampered transaction before signing or touching the server's rpcUrl", async () => {
  const drain = SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1e9 });
  const tx = challengeTx({ extra: [drain] });
  const client = new MimirAgentClient({
    baseUrl: "http://mimir.test",
    agentId: "a",
    operator,
    programId: PROGRAM,
    rpc: { base: "http://127.0.0.1:9" },
  });
  await assert.rejects(
    client.submit(
      {
        layer: "base",
        rpcUrl: "https://evil.example/",
        transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
        description: "x",
        recentBlockhash: BLOCKHASH,
        lastValidBlockHeight: 1,
      },
      { action: "challenge" },
    ),
    /refusing to sign/,
  );
});

test("withdraw must pay out to the operator's own USDC account", async () => {
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const mint = Keypair.generate().publicKey;
  const mk = (dest: PublicKey) => {
    const tx = new Transaction({ feePayer: operator.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
    const r = Keypair.generate().publicKey;
    // user, config, balance, owner, user_token, ...
    tx.add(mimirIx("withdraw", u64(5n), [operator.publicKey, r, r, operator.publicKey, dest]));
    return tx;
  };
  const opts = { ...base, usdcMint: mint, expect: { action: "withdraw", amountUnits: 5n } };
  verifyPreparedTransaction(mk(getAssociatedTokenAddressSync(mint, operator.publicKey, true)), opts);
  assert.throws(() => verifyPreparedTransaction(mk(Keypair.generate().publicKey), opts), /destination/);
});

test("a repeated stake instruction or a foreign agent fee recipient is refused", () => {
  const second = challengeTx().instructions[0];
  assert.throws(() => verifyPreparedTransaction(challengeTx({ extra: [second] }), { ...base, expect: { action: "challenge" } }), /more than once/);
  const thief = Keypair.generate().publicKey;
  const withAgent = (agent: PublicKey) => {
    const tx = new Transaction({ feePayer: operator.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
    const rnd = Keypair.generate().publicKey;
    tx.add(mimirIx("challenge_claim", Buffer.concat([u64(2_000_000n), Buffer.from([1]), agent.toBuffer()]), [operator.publicKey, rnd, claimPda(7n), rnd]));
    return tx;
  };
  assert.throws(() => verifyPreparedTransaction(withAgent(thief), { ...base, expect: { action: "challenge" } }), /agent fee recipient/);
  verifyPreparedTransaction(withAgent(operator.publicKey), { ...base, expect: { action: "challenge" } });
  verifyPreparedTransaction(withAgent(thief), { ...base, expect: { action: "challenge", agentPayout: thief } });
});

test("create_claim: the stake must match the request", () => {
  const str = (s: string) => Buffer.concat([Buffer.from(Uint32Array.of(s.length).buffer), Buffer.from(s)]);
  const create = (stake: bigint) => {
    const tx = new Transaction({ feePayer: operator.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
    const args = Buffer.concat([str("Q?"), str("Yes"), str("No"), str("https://x"), str("crypto"), u64(stake), u64(1n), Buffer.from([4, 0])]);
    const rnd = Keypair.generate().publicKey;
    tx.add(mimirIx("create_claim", args, [operator.publicKey, rnd, rnd, rnd, rnd, rnd, rnd]));
    return tx;
  };
  verifyPreparedTransaction(create(2_000_000n), { ...base, expect: { action: "createClaim", amountUnits: 2_000_000n } });
  assert.throws(
    () => verifyPreparedTransaction(create(50_000_000n), { ...base, expect: { action: "createClaim", amountUnits: 2_000_000n } }),
    /stake differs/,
  );
});
