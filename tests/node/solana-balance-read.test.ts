import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction } from "@solana/web3.js";
import { getVirtualBalance, type BrowserMimir } from "../../lib/solana/browser-client";
import { KeypairWallet } from "../../lib/solana/client";
import { MIMIR_PROGRAM_ID } from "../../lib/solana/config";

test("balance reads ignore the stale layer after delegation and undelegation", async () => {
  const calls: string[] = [];
  let accountOwner = MIMIR_PROGRAM_ID;
  let exists = true;
  const m = {
    owner: Keypair.generate().publicKey,
    base: {
      provider: { connection: { getAccountInfo: async () => exists ? { owner: accountOwner } : null } },
      account: { userBalance: { fetch: async () => { calls.push("base"); return { amount: 2_000_000n }; } } },
    },
    er: { account: { userBalance: { fetch: async () => { calls.push("er"); return { amount: 5_000_000n }; } } } },
  } as unknown as BrowserMimir;
  assert.equal(await getVirtualBalance(m), 2_000_000n);
  assert.deepEqual(calls, ["base"], "an old ER copy cannot overstate an undelegated balance");
  calls.length = 0;
  accountOwner = Keypair.generate().publicKey;
  assert.equal(await getVirtualBalance(m), 5_000_000n);
  assert.deepEqual(calls, ["er"]);
  calls.length = 0;
  exists = false;
  assert.equal(await getVirtualBalance(m), 0n);
  assert.deepEqual(calls, []);
});

test("a worker refuses to sign when the provider serves another ledger", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ result: "a-different-ledger" });
  try {
    const wallet = new KeypairWallet(Keypair.generate());
    const tx = new Transaction();
    await assert.rejects(wallet.signTransaction(tx), /not Solana devnet/);
    assert.equal(tx.signatures.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
