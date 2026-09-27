import test from "node:test";
import assert from "node:assert/strict";

import { programErrorOf, txErrorMessage } from "../../lib/tx-errors";

test("a wallet rejection reads as a rejection, however it is wrapped", () => {
  const adapter = Object.assign(new Error("User rejected the request."), {
    name: "WalletSignTransactionError",
    error: { code: 4001, message: "User rejected the request." },
  });
  assert.equal(txErrorMessage(adapter), "You rejected the request in your wallet.");
  assert.equal(txErrorMessage({ code: 4001 }), "You rejected the request in your wallet.");
});

test("a failed simulation maps the custom program error to the Mimir message", () => {
  // 6011 = 0x177b = ClaimFull
  const sim = Object.assign(
    new Error(
      "Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x177b. \nLogs: \n[...]",
    ),
    { name: "SendTransactionError" },
  );
  assert.equal(txErrorMessage(sim), "Transaction reverted: Mimir: claim is full");
  assert.equal(programErrorOf(sim)?.name, "ClaimFull");
});

test("Anchor errors are read from their error code", () => {
  const anchor = {
    message: "AnchorError occurred. Error Code: SelfChallenge. Error Number: 6009.",
    errorCode: { code: "SelfChallenge", number: 6009 },
    errorMessage: "Mimir: self-challenge",
  };
  assert.equal(txErrorMessage(anchor), "Transaction reverted: Mimir: self-challenge");
});

test("fee, token-balance and expiry failures get their own lines", () => {
  assert.match(
    txErrorMessage(new Error("Attempt to debit an account but found no record of a prior credit.")),
    /Not enough SOL/,
  );
  assert.match(
    txErrorMessage({ message: "failed", logs: ["Program log: Error: insufficient funds", "custom program error: 0x1"] }),
    /Not enough USDC/,
  );
  assert.match(
    txErrorMessage(Object.assign(new Error("Signature abc has expired: block height exceeded."), { name: "TransactionExpiredBlockheightExceededError" })),
    /expired/,
  );
});

test("anything else falls back to the first line, or the fallback", () => {
  assert.equal(txErrorMessage(new Error("first line\nsecond line")), "first line");
  assert.equal(txErrorMessage(null), "Transaction failed. Please try again.");
  assert.equal(txErrorMessage({ name: "WalletNotConnectedError" }), "Connect a wallet first.");
});
