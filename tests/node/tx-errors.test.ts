import test from "node:test";
import assert from "node:assert/strict";

import { txErrorMessage } from "../../lib/tx-errors";

test("a wallet rejection reads as a rejection, however it is wrapped", () => {
  const wrapped = Object.assign(new Error("User rejected the request."), {
    name: "TransactionExecutionError",
    cause: { code: 4001, message: "User rejected the request." },
  });
  assert.equal(txErrorMessage(wrapped), "You rejected the request in your wallet.");
  assert.equal(txErrorMessage({ code: 4001 }), "You rejected the request in your wallet.");
  assert.equal(txErrorMessage({ name: "UserRejectedRequestError", message: "x" }), "You rejected the request in your wallet.");
});

test("a revert reason is read out of the error text", () => {
  const err = new Error('The contract function "stake" reverted with the following reason:\nMimir: market locked\n\nContract Call: …');
  assert.equal(txErrorMessage(err), "Transaction reverted: Mimir: market locked");
});

test("insufficient funds gets its own line; viem's shortMessage wins over the long one", () => {
  assert.match(txErrorMessage(new Error("insufficient funds for gas * price + value")), /Not enough USDC/);
  assert.equal(txErrorMessage({ message: "long\ntext", shortMessage: "Nonce too low." }), "Nonce too low.");
});

test("anything else falls back to the first line, or the fallback", () => {
  assert.equal(txErrorMessage(new Error("first line\nsecond line")), "first line");
  assert.equal(txErrorMessage(null), "Transaction failed. Please try again.");
  assert.equal(txErrorMessage({ name: "ConnectorNotConnectedError" }), "Connect a wallet first.");
});
