import assert from "node:assert/strict";
import test from "node:test";

import { circleBlockchain, circleSignsOnly } from "../../lib/chains/house";
import { circleTxObject, gasBudget, signedTxHex } from "../../lib/server/circle-sign";

test("circle: BNB Chain is Circle's generic EVM and signs only; Base and Arc execute", () => {
  assert.equal(circleBlockchain("bsc", "mainnet"), "EVM");
  assert.equal(circleBlockchain("bsc", "testnet"), "EVM-TESTNET");
  assert.equal(circleSignsOnly("bsc", "mainnet"), true);
  assert.equal(circleSignsOnly("bsc", "testnet"), true);
  assert.equal(circleSignsOnly("base", "mainnet"), false);
  assert.equal(circleSignsOnly("arc", "testnet"), false);
});

test("circle: the tx object carries decimal strings and one price for both EIP-1559 caps", () => {
  const tx = circleTxObject({
    chainId: 56,
    nonce: 7,
    to: "0x00000000000000000000000000000000000000aa",
    data: "0x095ea7b3",
    value: 0n,
    gas: 65_000n,
    gasPrice: 1_000_000_000n,
  });
  assert.deepEqual(tx, {
    chainId: 56,
    nonce: "7",
    to: "0x00000000000000000000000000000000000000aa",
    data: "0x095ea7b3",
    value: "0",
    gas: "65000",
    maxFeePerGas: "1000000000",
    maxPriorityFeePerGas: "1000000000",
  });
});

test("circle: signed tx is normalised to 0x hex and anything else is refused", () => {
  assert.equal(signedTxHex("0x02f8ab"), "0x02f8ab");
  assert.equal(signedTxHex(" 02F8AB \n"), "0x02F8AB");
  assert.throws(() => signedTxHex(""), /not hex/);
  assert.throws(() => signedTxHex("0x"), /not hex/);
  assert.throws(() => signedTxHex("0x02f8a"), /not hex/);
  assert.throws(() => signedTxHex("AgAAAA=="), /not hex/);
});

test("circle: gas budget adds 20% head room and covers value", () => {
  assert.deepEqual(gasBudget(100_000n, 3n), { gas: 120_000n, maxCostWei: 360_000n });
  assert.deepEqual(gasBudget(50_000n, 2n, 1_000n), { gas: 60_000n, maxCostWei: 121_000n });
});
