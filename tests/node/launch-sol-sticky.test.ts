// H1: a transaction's whole lifecycle (blockhash, send, rebroadcast, status polling, expiry) stays on
// ONE endpoint; another endpoint is only asked for history before anything is declared "not landed".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { PROGRAMS } from "../../lib/launch/solana/policy";
import { createSubmitter } from "../../lib/launch/solana/submit";
import { fakeConnection, fakePrivy, fastSend, unsignedTx } from "../../lib/launch/solana/testkit";
import { AmbiguousSendError, type SolanaError } from "../../lib/launch/solana/util";

const walletKp = Keypair.generate();
const W = walletKp.publicKey.toBase58();
const job = () => ({ walletId: "w", wallet: W, unsigned: { tx: unsignedTx(walletKp.publicKey, [PROGRAMS.computeBudget]) } });

test("submitter: blockhash, send and status polling all go to the picked endpoint; reads elsewhere", async () => {
  const reads = fakeConnection({ balance: 5_000_000_000n });
  const a = fakeConnection({ balance: 5_000_000_000n });
  const b = fakeConnection({ balance: 5_000_000_000n });
  const submitter = createSubmitter({ privy: fakePrivy(walletKp), connection: reads, send: fastSend, maxAttempts: 1, endpoints: { pickEndpoint: () => ({ url: "a", connection: a, witnesses: [b] }) } });
  await submitter.run("x", async () => job(), () => null);
  assert.equal(a.counters.send, 1);
  assert.equal(a.counters.blockhash, 1, "the blockhash (and its lastValidBlockHeight) comes from the sticky endpoint");
  assert.ok(a.counters.status >= 1);
  assert.deepEqual([reads.counters.send, reads.counters.status, reads.counters.blockhash, b.counters.send], [0, 0, 0, 0]);
});

test("submitter: an expired tx that the second endpoint cannot vouch for is never rebuilt (no double payout)", async () => {
  const a = fakeConnection({ balance: 5_000_000_000n, sendError: () => new Error("socket hang up"), status: () => null, blockHeight: () => 10_000 });
  const b = fakeConnection({ status: () => null, blockHeight: () => 900 }); // lagging: inside lastValidBlockHeight + margin
  let builds = 0;
  const submitter = createSubmitter({ privy: fakePrivy(walletKp), connection: a, send: fastSend, maxAttempts: 3, endpoints: { pickEndpoint: () => ({ url: "a", connection: a, witnesses: [b] }) } });
  await assert.rejects(submitter.run("pay", async () => (builds++, job()), () => null), (e: SolanaError) => e instanceof AmbiguousSendError);
  assert.equal(builds, 1);
});

test("submitter: no money endpoint configured -> refused before signing", async () => {
  const privy = fakePrivy(walletKp);
  const submitter = createSubmitter({ privy, connection: fakeConnection(), send: fastSend, maxAttempts: 1, endpoints: { pickEndpoint: () => null } });
  await assert.rejects(submitter.run("x", async () => job(), () => null), /no RPC endpoint/);
  assert.equal(privy.seen.length, 0);
});
