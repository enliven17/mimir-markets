import test from "node:test";
import assert from "node:assert/strict";

import { parseVerdict } from "../../agents/oracle/evaluate";
import { applyFetcherTrust, applyPriceConsensus, tierVerdict } from "../../agents/oracle/decide";

test("a verdict parses out of chatty output, and prose does not", () => {
  assert.deepEqual(parseVerdict('Sure: {"verdict":"CREATOR_WINS","confidence":91.6,"explanation":"x"} ok'), {
    verdict: "CREATOR_WINS",
    confidence: 92,
    explanation: "x",
  });
  assert.equal(parseVerdict("- Side A looks right\n- confidence high"), null);
  assert.equal(parseVerdict('{"verdict":"MAYBE","confidence":50}'), null);
});

test("confidence tiers settle, mark contested, or refund", () => {
  const v = (confidence: number) => ({ verdict: "CHALLENGERS_WIN" as const, confidence, explanation: "e" });
  assert.equal(tierVerdict(v(85)).explanation, "e");
  assert.match(tierVerdict(v(70)).explanation, /^\[CONTESTED\]/);
  assert.equal(tierVerdict(v(40)).verdict, "UNRESOLVABLE");
  assert.equal(applyFetcherTrust(v(95), "jina").confidence, 75, "scraped evidence is capped below FIRM");
  assert.equal(applyFetcherTrust(v(95), "flashtrade-api").confidence, 95);
});

test("price consensus refunds a model that contradicts two agreeing sources", () => {
  const deadline = 1_800_000_000;
  const claim = {
    question: "Will BTC trade above $100,000 at the deadline?",
    creatorPosition: "Yes: above",
    counterPosition: "No: not above",
    deadline,
  };
  const prices = {
    symbol: "BTC",
    threshold: 100_000,
    readings: [
      { source: "coingecko" as const, priceUsd: 101_000, at: deadline * 1000 },
      { source: "chainlink" as const, priceUsd: 101_200, at: deadline * 1000 },
    ],
  };
  const wrong = applyPriceConsensus(claim, { verdict: "CHALLENGERS_WIN", confidence: 90, explanation: "" }, prices);
  assert.equal(wrong.verdict.verdict, "UNRESOLVABLE");
  const right = applyPriceConsensus(claim, { verdict: "CREATOR_WINS", confidence: 80, explanation: "" }, prices);
  assert.equal(right.verdict.verdict, "CREATOR_WINS");
  assert.ok(right.verdict.confidence > 80, "agreement boosts only the side the data backs");
});

test("the FIRM-only rule covers every house address, not just the oracle", async () => {
  const { Keypair } = await import("@solana/web3.js");
  const { houseHoldsPosition } = await import("../../agents/oracle/decide");
  const oracle = Keypair.generate().publicKey;
  const creatorWallet = Keypair.generate().publicKey;
  const persona = Keypair.generate().publicKey;
  const stranger = Keypair.generate().publicKey;
  const house = new Set([oracle.toBase58(), creatorWallet.toBase58(), persona.toBase58()]);
  const claim = (creator: typeof oracle, challengers: Array<typeof oracle> = []) =>
    ({ creator, challengers: challengers.map((addr) => ({ addr })) }) as never;
  assert.equal(houseHoldsPosition(claim(creatorWallet), { oracle, house }), true, "market creator");
  assert.equal(houseHoldsPosition(claim(stranger, [persona]), { oracle, house }), true, "council persona");
  assert.equal(houseHoldsPosition(claim(stranger, [oracle]), { oracle }), true, "the oracle itself");
  assert.equal(houseHoldsPosition(claim(stranger, [Keypair.generate().publicKey]), { oracle, house }), false);
});

test("Polymarket settles from UMA's resolution, waits, then refunds", async () => {
  const { polymarketOutcome, POLYMARKET_READ_RETRY_SECS } = await import("../../agents/oracle/decide");
  const deadline = 1_800_000_000;
  const claim = {
    deadline,
    createdAt: deadline - 10 * 86_400,
    question: "Per Polymarket (closes on or before Jan 15, 2027): Will the Fed cut rates at the December 2026 meeting?",
    creatorPosition: "Yes: resolves YES",
    counterPosition: "No: resolves NO",
  };
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  const market = (extra: Record<string, unknown> = {}) => ({
    question: "Will the Fed cut rates at the December 2026 meeting?",
    endDate: iso(deadline),
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.4", "0.6"]',
    closed: false,
    ...extra,
  });
  const resolved = (yes: string, no: string) =>
    market({ closed: true, umaResolutionStatus: "resolved", outcomePrices: JSON.stringify([yes, no]), closedTime: "2027-01-15 12:00:00+00" });
  const ok = (m: Record<string, unknown> | null) => ({ ok: true as const, market: m });
  const grace = 72 * 3600;
  const soon = deadline + 3600;
  assert.deepEqual(polymarketOutcome(claim, ok(market()), soon), { kind: "defer" });
  assert.deepEqual(polymarketOutcome(claim, { ok: false }, soon), { kind: "defer" }, "unreadable status waits too");
  const yes = polymarketOutcome(claim, ok(resolved("1", "0")), soon);
  assert.ok(yes.kind === "settle" && yes.side === "CREATOR_WINS");
  const no = polymarketOutcome(claim, ok(resolved("0", "1")), soon);
  assert.ok(no.kind === "settle" && no.side === "CHALLENGERS_WIN");
  assert.equal(polymarketOutcome(claim, ok(resolved("0.5", "0.5")), soon).kind, "continue", "50/50 goes to the normal path");
  assert.equal(polymarketOutcome(claim, ok(market()), deadline + grace + 1).kind, "refund", "read, and UMA unresolved at the grace");
  // A failed read is not "unresolved": it is retried for an extra window first.
  assert.equal(polymarketOutcome(claim, { ok: false }, deadline + grace + 1).kind, "defer");
  assert.equal(POLYMARKET_READ_RETRY_SECS, 24 * 3600);
  assert.equal(polymarketOutcome(claim, { ok: false }, deadline + grace + POLYMARKET_READ_RETRY_SECS + 1).kind, "refund");
  assert.equal(polymarketOutcome(claim, ok(null), soon).kind, "continue", "not exactly one market");
});

test("a Polymarket market settles a claim only when it is bound to it", async () => {
  const { polymarketOutcome } = await import("../../agents/oracle/decide");
  const deadline = 1_800_000_000;
  const claim = {
    deadline,
    createdAt: deadline - 10 * 86_400,
    question: "Will the Fed cut rates at the December 2026 meeting?",
    creatorPosition: "Yes",
    counterPosition: "No",
  };
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  const resolvedYes = (extra: Record<string, unknown>) => ({
    ok: true as const,
    market: {
      question: "Will the Fed cut rates at the December 2026 meeting?",
      endDate: iso(deadline),
      outcomes: '["Yes", "No"]',
      outcomePrices: '["1", "0"]',
      closed: true,
      umaResolutionStatus: "resolved",
      closedTime: iso(deadline - 3600),
      ...extra,
    },
  });
  const now = deadline + 600;
  assert.equal(polymarketOutcome(claim, resolvedYes({}), now).kind, "settle");
  // Already decided when the claim was created: a free option, never deterministic.
  const early = polymarketOutcome(claim, resolvedYes({ closedTime: iso(claim.createdAt - 60) }), now);
  assert.equal(early.kind, "continue");
  assert.equal(polymarketOutcome(claim, resolvedYes({ closedTime: undefined, umaEndDate: undefined }), now).kind, "continue", "closed, no close time");
  // Ends long after the claim's deadline: the claim is not about this market's result.
  assert.equal(polymarketOutcome(claim, resolvedYes({ endDate: iso(deadline + 30 * 86_400) }), now).kind, "continue");
  // A different question entirely.
  assert.equal(polymarketOutcome(claim, resolvedYes({ question: "Will Bitcoin hit $1m in 2026?" }), now).kind, "continue");
});

test("DEX-token agreement never boosts confidence", () => {
  const deadline = 1_800_000_000;
  const claim = { question: "Will $ANSEM trade above $0.01 at the deadline?", creatorPosition: "Yes", counterPosition: "No", deadline };
  const prices = {
    symbol: "ANSEM",
    threshold: 0.01,
    readings: [
      { source: "dexscreener" as const, priceUsd: 0.02, at: deadline * 1000 },
      { source: "jupiter" as const, priceUsd: 0.0201, at: deadline * 1000 },
    ],
  };
  const out = applyPriceConsensus(claim, { verdict: "CREATOR_WINS", confidence: 72, explanation: "" }, prices);
  assert.equal(out.verdict.confidence, 72);
});

test("the on-chain summary carries no links; the oracle fetches with a browser UA", async () => {
  const { decisionFor, BROWSER_USER_AGENT } = await import("../../agents/oracle/decide");
  const { Keypair } = await import("@solana/web3.js");
  const claim = {
    id: 7n,
    creator: Keypair.generate().publicKey,
    question: "q",
    creatorPosition: "Yes",
    counterPosition: "No",
    resolutionUrl: "https://x.io",
    category: "custom",
    deadline: 1,
    challengers: [],
  } as never;
  const d = decisionFor(
    claim,
    { verdict: "CREATOR_WINS", confidence: 90, explanation: "Claim your refund at https://evil.xyz/r or t.me/scam" },
    { adjustments: [] },
  );
  assert.ok(!/evil|t\.me|https?:/.test(d.verdict.explanation), d.verdict.explanation);
  assert.equal(d.bundle.finalVerdict.explanation, d.verdict.explanation, "bundle and chain agree");
  assert.match(BROWSER_USER_AGENT, /^Mozilla\/5\.0/);
  assert.ok(!/mimir/i.test(BROWSER_USER_AGENT));
});

test("a price claim with fewer than two deadline readings defers, then refunds; never falls to a model", async () => {
  const { priceDataGate, PRICE_DEFER_SECS } = await import("../../agents/oracle/decide");
  const deadline = 1_000_000;
  assert.equal(priceDataGate(2, deadline, deadline + 10), "ok");
  assert.equal(priceDataGate(1, deadline, deadline + 10), "defer");
  assert.equal(priceDataGate(0, deadline, deadline + PRICE_DEFER_SECS), "defer");
  assert.equal(priceDataGate(1, deadline, deadline + PRICE_DEFER_SECS + 1), "refund");
});

test("an asset only CoinGecko prices historically settles on one deadline reading; majors and DEX tokens need two", async () => {
  const { priceDataGate } = await import("../../agents/oracle/decide");
  const { deadlineReadingsRequired } = await import("../../lib/server/price-sources");
  const prev = process.env.CMC_API_KEY;
  delete process.env.CMC_API_KEY;
  try {
    assert.equal(deadlineReadingsRequired("XRP"), 1, "CoinGecko only");
    assert.equal(deadlineReadingsRequired("BTC"), 2, "CoinGecko + Chainlink");
    assert.equal(deadlineReadingsRequired("ANSEM"), 2, "DEX token: never one number");
    assert.equal(priceDataGate(1, 1000, 1010, 1), "ok");
  } finally {
    if (prev !== undefined) process.env.CMC_API_KEY = prev;
  }
});
