import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "../../lib/solana/config";
import {
  CALL_MEMO_PROGRAM,
  callMemo,
  verifySolanaPayment,
} from "../../lib/solana/payment";
import { parsePayment, quote } from "../../lib/launch/paid-call";

test("native paid calls accept only case-sensitive Solana signatures and expose devnet offers", () => {
  const signature = "5".repeat(88),
    secret = `0x${"ab".repeat(32)}`;
  assert.equal(parsePayment(`solana:${signature}:${secret}`)?.tx, signature);
  assert.equal(parsePayment(`arc:0x${"ab".repeat(32)}`), null);
  assert.equal(parsePayment(`solana:${signature}`), null);
  assert.deepEqual(
    quote(
      0.05,
      { arc: "old", base: "old", solana: "native" },
      { contract: "", callId: "commitment", secret },
    ).map((o) => [o.chain, o.units, o.payTo, o.callId]),
    [["solana", "50000", "native", "commitment"]],
  );
});

test("a paid call requires a fresh confirmed USDC credit and the quote's memo", async () => {
  const owner = Keypair.generate().publicKey,
    callId = `0x${"ab".repeat(32)}`,
    now = Date.now();
  const balance = (amount: string) => ({
    accountIndex: 0,
    mint: USDC_MINT.toBase58(),
    owner: owner.toBase58(),
    uiTokenAmount: { amount, decimals: 6 },
  });
  const tx: any = {
    blockTime: Math.floor(now / 1000),
    meta: {
      err: null,
      preTokenBalances: [balance("100")],
      postTokenBalances: [balance("50100")],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: getAssociatedTokenAddressSync(USDC_MINT, owner) },
        ],
        instructions: [
          { programId: CALL_MEMO_PROGRAM, parsed: callMemo(callId) },
        ],
      },
    },
  };
  const reader = { getParsedTransaction: async () => tx } as any;
  const input = {
    hash: "signature",
    to: owner.toBase58(),
    callId,
    min: 50_000n,
    now,
  };
  assert.deepEqual(await verifySolanaPayment(reader, input), {
    ok: true,
    units: 50_000n,
  });
  assert.equal(
    (await verifySolanaPayment(reader, { ...input, callId: "wrong" })).ok,
    false,
  );
  tx.meta.postTokenBalances[0].mint = Keypair.generate().publicKey.toBase58();
  assert.equal((await verifySolanaPayment(reader, input)).ok, false);
  tx.meta.postTokenBalances = [balance("50100")];
  tx.blockTime -= 3601;
  assert.equal((await verifySolanaPayment(reader, input)).ok, false);
  tx.blockTime = Math.floor(now / 1000);
  tx.meta.err = { InstructionError: [0, "failed"] };
  assert.equal((await verifySolanaPayment(reader, input)).ok, false);
});
