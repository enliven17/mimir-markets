import assert from "node:assert/strict";
import { test } from "node:test";

import { assessShield, type ShieldInfo, type ShieldTrade } from "../../lib/launch/engine/shield";

const buy = (from: string, native: number): ShieldTrade => ({ kind: "buy", from, native, tokens: native * 1e6, at: 0 });
const healthy = Array.from({ length: 12 }, (_, i) => buy(`0x${i}`, 0.01 + i * 0.003));
const info: ShieldInfo = { holders: { count: 300, distribution_percentage: { top_10: "40" } }, developer_address: "0xdev", developer_holding_percentage: "2", twitter_handle: "pons", gt_score: 60 };

test("spread-out buyers and a quiet creator score full", () => {
  const s = assessShield(info, healthy);
  assert.deepEqual(s.blocks, []);
  assert.equal(s.score, 100);
  assert.equal(s.facts.buyers, 12);
});

test("honeypots, creator concentration and split buys block", () => {
  assert.match(assessShield({ ...info, is_honeypot: true }, healthy).blocks[0]!, /honeypot/);
  assert.match(assessShield({ ...info, developer_holding_percentage: "22" }, healthy).blocks[0]!, /creator still holds 22%/);
  const split = [...healthy, ...["a", "b", "c", "d"].map((w) => buy(`0x${w}`, 0.0123457))];
  const s = assessShield(info, split);
  assert.match(s.blocks[0]!, /4 different wallets bought the exact same amount/);
  assert.equal(s.score, 0);
});

test("warnings lower the score without blocking", () => {
  const trades = [...healthy, { kind: "sell", from: "0xDEV", native: 0.2, tokens: 1, at: 0 } as ShieldTrade, buy("0xwhale", 1)];
  const s = assessShield({ ...info, twitter_handle: null }, trades);
  assert.deepEqual(s.blocks, []);
  assert.equal(s.warns.length, 3);
  assert.equal(s.score, 55);
});
