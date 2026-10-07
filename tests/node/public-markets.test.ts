import { test } from "node:test";
import assert from "node:assert/strict";

import { filterMarkets, oldCliGone, parseMarketRef, phaseOf, toPublic, usdc, type IndexedMarket } from "../../lib/server/public-markets";

const NOW = 1_800_000_000;
const base: IndexedMarket = {
  kind: "vs",
  marketId: 12,
  creator: "0xabc",
  question: "Will BTC trade above $80,000 at the deadline?",
  labelA: "Yes",
  labelB: "No",
  resolutionUrl: "https://example.com",
  category: "crypto",
  deadline: NOW + 3600,
  createdAt: NOW - 60,
  status: "active",
  winner: 0,
  summary: "",
  stakeA: "1000000000000000000",
  stakeB: "99500000000000000",
  participants: 2,
};

test("usdc turns 18-decimal wei into a trimmed decimal string", () => {
  assert.equal(usdc("1000000000000000000"), "1");
  assert.equal(usdc("99500000000000000"), "0.0995");
  assert.equal(usdc("0"), "0");
  assert.equal(usdc("1500000000000000000"), "1.5");
});

test("phase: open until a minute before the deadline, then awaiting; other statuses pass through", () => {
  assert.equal(phaseOf(base, NOW), "open");
  assert.equal(phaseOf({ ...base, deadline: NOW + 30 }, NOW), "awaiting");
  assert.equal(phaseOf({ ...base, status: "resolved" }, NOW), "resolved");
});

test("toPublic shapes a market for the CLI", () => {
  const m = toPublic(base, NOW);
  assert.equal(m.id, "vs-12");
  assert.deepEqual(m.sideA, { label: "Yes", usdc: "1" });
  assert.deepEqual(m.sideB, { label: "No", usdc: "0.0995" });
  assert.equal(m.winner, null, "no winner before settlement");
  assert.match(m.url, /\/arena\/arc\/vs\/12$/);
  assert.equal(toPublic({ ...base, status: "resolved", winner: 2, summary: "No." }, NOW).winner, 2);
});

test("filters: live, closing (soonest first, within a day), settled, all", () => {
  const live = toPublic(base, NOW);
  const soon = toPublic({ ...base, marketId: 13, deadline: NOW + 600 }, NOW);
  const far = toPublic({ ...base, marketId: 14, deadline: NOW + 3 * 86_400 }, NOW);
  const done = toPublic({ ...base, marketId: 15, status: "resolved", winner: 1 }, NOW);
  const refunded = toPublic({ ...base, marketId: 16, status: "cancelled" }, NOW);
  const all = [live, soon, far, done, refunded];
  assert.deepEqual(filterMarkets(all, "live", NOW).map((m) => m.marketId), [12, 13, 14]);
  assert.deepEqual(filterMarkets(all, "closing", NOW).map((m) => m.marketId), [13, 12]);
  assert.deepEqual(filterMarkets(all, "settled", NOW).map((m) => m.marketId), [15, 16]);
  assert.equal(filterMarkets(all, "all", NOW).length, 5);
});

test("market refs: vs-12, pool-3, #12 and 12 (VS by default)", () => {
  assert.deepEqual(parseMarketRef("vs-12"), { kind: "vs", marketId: 12 });
  assert.deepEqual(parseMarketRef("POOL-3"), { kind: "pool", marketId: 3 });
  assert.deepEqual(parseMarketRef("#12"), { kind: "vs", marketId: 12 });
  assert.deepEqual(parseMarketRef("12"), { kind: "vs", marketId: 12 });
  assert.equal(parseMarketRef("abc"), null);
  assert.equal(parseMarketRef("vs-"), null);
});

test("the old CLI (before 0.4) is told to update; everyone else passes", async () => {
  const req = (ua?: string) => new Request("https://x/api/arena/claims", { headers: ua ? { "user-agent": ua } : {} });
  const gone = oldCliGone(req("mimir-terminal/0.3.0"));
  assert.ok(gone);
  assert.equal(gone.status, 410);
  assert.match((await gone.json()).error, /npm i -g mimir-terminal@latest/);
  assert.equal(oldCliGone(req("mimir-terminal/0.4.0")), null);
  assert.equal(oldCliGone(req("Mozilla/5.0")), null);
  assert.equal(oldCliGone(req()), null);
});
