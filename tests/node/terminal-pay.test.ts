import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";

import { canAfford, parseSessionHeader, splitCharge, terminalSessionMessage, TERMINAL_SESSION_TTL_MS } from "../../lib/terminal/pay";
import { fitToRoom, groupCharges, MAX_WAIT_MS, MIN_SETTLE_UNITS, readyToSettle } from "../../agents/terminal/settle";
import { signAgentMessage } from "../../lib/agents/signature";

test("a charge splits 99.5% / 0.5%, the fee rounding down so the agent never loses a unit", () => {
  assert.deepEqual(splitCharge(20_000n), { agentUnits: 19_900n, feeUnits: 100n }); // 0.02 USDC
  assert.deepEqual(splitCharge(1_000n), { agentUnits: 995n, feeUnits: 5n }); // the minimum price
  assert.deepEqual(splitCharge(199n), { agentUnits: 199n, feeUnits: 0n }, "0.5% of 199 rounds to 0");
  assert.deepEqual(splitCharge(0n), { agentUnits: 0n, feeUnits: 0n });
  for (const total of [1n, 7n, 12_345n, 1_000_000n]) {
    const { agentUnits, feeUnits } = splitCharge(total);
    assert.equal(agentUnits + feeUnits, total, "nothing is lost or created");
  }
});

test("a wallet can pay only within a limit approved to the terminal and its balance, counting what it owes", () => {
  const base = { delegate: "D", expectedDelegate: "D", delegatedUnits: 1_000_000n, balanceUnits: 5_000_000n, owedUnits: 0n, priceUnits: 20_000n };
  assert.equal(canAfford(base), "ok");
  assert.equal(canAfford({ ...base, delegate: "OTHER" }), "no_limit", "a limit approved to someone else is not ours");
  assert.equal(canAfford({ ...base, delegate: null, delegatedUnits: 0n }), "no_limit");
  assert.equal(canAfford({ ...base, delegatedUnits: 100_000n, owedUnits: 90_000n }), "limit_too_low", "unpaid charges eat the limit");
  assert.equal(canAfford({ ...base, delegatedUnits: 100_000n, owedUnits: 80_000n }), "ok", "exactly at the limit is fine");
  assert.equal(canAfford({ ...base, balanceUnits: 10_000n }), "balance_too_low");
});

test("a terminal session is the wallet's signature over a dated message, and it expires", () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const now = 1_800_000_000_000;
  const sig = signAgentMessage(terminalSessionMessage(wallet, now), kp.secretKey);
  assert.deepEqual(parseSessionHeader(`${now}.${sig}`, now + 1000), { signedAt: now, signature: sig });
  assert.equal(parseSessionHeader(`${now}.${sig}`, now + TERMINAL_SESSION_TTL_MS + 1), null, "expired");
  assert.equal(parseSessionHeader(`${now + 10 * 60_000}.${sig}`, now), null, "from the future");
  assert.equal(parseSessionHeader("garbage", now), null);
  assert.match(terminalSessionMessage(wallet, now), /within the USDC spending limit you approved/);
});

test("the worker batches charges per payer and payee, largest batch first", () => {
  const row = (id: number, wallet: string, payout: string, units: string, status = "pending", at = 1000) =>
    ({ id, wallet, payout_wallet: payout, amount_units: units, status, created_at: String(at) });
  const groups = groupCharges([row(1, "U1", "A", "20000"), row(2, "U1", "A", "20000", "failed", 500), row(3, "U1", "B", "100000"), row(4, "U2", "A", "1000")]);
  assert.deepEqual(
    groups.map((g) => [g.wallet, g.payoutWallet, g.rows.map((r) => r.id), g.totalUnits, g.oldestMs]),
    [
      ["U1", "B", [3], 100_000n, 1000],
      ["U1", "A", [1, 2], 40_000n, 500],
      ["U2", "A", [4], 1_000n, 1000],
    ],
  );
  assert.equal(groupCharges([row(1, "U", "A", "1")], 0).length, 0);
});

test("a batch settles only what the limit covers now, and small batches wait until they are worth a fee", () => {
  const rows = [{ id: 1, units: 20_000n }, { id: 2, units: 20_000n }, { id: 3, units: 20_000n }];
  assert.deepEqual(fitToRoom(rows, 45_000n).map((r) => r.id), [1, 2], "the oldest that fit, in order");
  assert.deepEqual(fitToRoom(rows, 10_000n), []);
  assert.deepEqual(fitToRoom(rows, 1_000_000n).map((r) => r.id), [1, 2, 3]);
  const now = 10_000_000;
  assert.equal(readyToSettle({ totalUnits: MIN_SETTLE_UNITS, oldestMs: now }, now), true);
  assert.equal(readyToSettle({ totalUnits: 1_000n, oldestMs: now - 60_000 }, now), false, "a 0.001 USDC charge waits");
  assert.equal(readyToSettle({ totalUnits: 1_000n, oldestMs: now - MAX_WAIT_MS }, now), true, "but not forever");
});

test("a wallet cannot owe more than the unpaid cap before it settles", () => {
  const base = { delegate: "D", expectedDelegate: "D", delegatedUnits: 50_000_000n, balanceUnits: 50_000_000n, priceUnits: 20_000n };
  assert.equal(canAfford({ ...base, owedUnits: 990_000n }), "settling");
  assert.equal(canAfford({ ...base, owedUnits: 900_000n }), "ok");
  assert.equal(canAfford({ ...base, owedUnits: 0n, priceUnits: 1_000_000n }), "ok", "one message at the max price always fits");
});

test("paid terminal charges are retired with Postgres: reserving one fails loudly, never silently succeeds", async () => {
  const { reserveCharge } = await import("../../lib/server/terminal-pay");
  await assert.rejects(
    () =>
      reserveCharge({
        wallet: "U", agentId: "a", payoutWallet: "P", priceUnits: 20_000n, delegate: "D",
        allowance: { delegate: "D", delegatedUnits: 100_000n, balanceUnits: 1_000_000n },
      }),
    /Postgres is retired/,
  );
});

test("house personas: thinking ones charge 0.01 USDC once paid chat is on, rule ones never", async () => {
  const { houseChatPriceUnits, HOUSE_CHAT_PRICE_UNITS } = await import("../../lib/terminal/pay");
  assert.equal(HOUSE_CHAT_PRICE_UNITS, 10_000);
  assert.equal(houseChatPriceUnits("optimist", "Delegate1111"), 10_000);
  assert.equal(houseChatPriceUnits("optimist", null), 0, "no delegate: paid chat is off");
  assert.equal(houseChatPriceUnits("contrarian", "Delegate1111"), 0, "rule personas call no model");
  assert.equal(houseChatPriceUnits("nobody", "Delegate1111"), 0);
});
