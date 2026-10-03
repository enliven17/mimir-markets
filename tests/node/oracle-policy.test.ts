import test from "node:test";
import assert from "node:assert/strict";

import { autoChallengeEnabled, ClaimBackoff, parseHedgeMode } from "../../agents/oracle/policy";
import { gammaUrlFor, parsePolymarketStatus } from "../../agents/oracle/polymarket";
import { alert } from "../../agents/oracle/alert";

test("HEDGE_MODE parses strictly and fails closed", () => {
  const dev = { mainnet: false, allowUnmanaged: false };
  assert.equal(parseHedgeMode(undefined, dev), "dry");
  assert.equal(parseHedgeMode("", { ...dev, mainnet: true }), "off", "mainnet default is off");
  assert.equal(parseHedgeMode(" Dry ", dev), "dry");
  assert.equal(parseHedgeMode("OFF", dev), "off");
  for (const bad of ["false", "0", "1", "true", "dryrun", "lve"]) {
    assert.throws(() => parseHedgeMode(bad, dev), /HEDGE_MODE/, bad);
  }
  assert.throws(() => parseHedgeMode("live", dev), /HEDGE_ALLOW_UNMANAGED/);
  assert.equal(parseHedgeMode("live ", { ...dev, allowUnmanaged: true }), "live");
});

test("auto-challenge is off on mainnet unless explicitly overridden", () => {
  assert.equal(autoChallengeEnabled({ requested: true, mainnet: false, mainnetOverride: false }), true);
  assert.equal(autoChallengeEnabled({ requested: true, mainnet: true, mainnetOverride: false }), false);
  assert.equal(autoChallengeEnabled({ requested: true, mainnet: true, mainnetOverride: true }), true);
  assert.equal(autoChallengeEnabled({ requested: false, mainnet: false, mainnetOverride: true }), false);
});

test("not-ready claims back off 5 min, doubling to 1 h", () => {
  let now = 0;
  const b = new ClaimBackoff(5 * 60_000, 60 * 60_000, () => now);
  assert.equal(b.ready("1"), true);
  const delays = [1, 2, 3, 4, 5, 6].map(() => b.defer("1"));
  assert.deepEqual(delays.map((d) => d / 60_000), [5, 10, 20, 40, 60, 60]);
  assert.equal(b.ready("1"), false);
  assert.equal(b.ready("2"), true, "per claim");
  now += 60 * 60_000;
  assert.equal(b.ready("1"), true);
  b.clear("1");
  assert.equal(b.defer("1"), 5 * 60_000, "cleared claims start over");
});

test("Polymarket URLs map to one Gamma market", () => {
  assert.equal(gammaUrlFor("https://gamma-api.polymarket.com/markets?slug=abc"), "https://gamma-api.polymarket.com/markets?slug=abc");
  assert.equal(gammaUrlFor("https://polymarket.com/market/will-x"), "https://gamma-api.polymarket.com/markets?slug=will-x");
  assert.equal(gammaUrlFor("https://polymarket.com/event/elec/will-y"), "https://gamma-api.polymarket.com/markets?slug=will-y");
  assert.equal(gammaUrlFor("https://polymarket.com/event/fed-october"), "https://gamma-api.polymarket.com/events?slug=fed-october");
  assert.equal(gammaUrlFor("https://polymarket.com/"), null);
  assert.equal(gammaUrlFor("https://evil.com/market/x"), null);
  // Raw Gamma queries are never followed: only the canonical single-slug form.
  assert.equal(gammaUrlFor("https://gamma-api.polymarket.com/markets?id=12345"), null);
  assert.equal(gammaUrlFor("https://gamma-api.polymarket.com/markets?slug=abc&closed=true"), null);
  assert.equal(gammaUrlFor("https://gamma-api.polymarket.com/markets?closed=true&limit=1"), null);
  assert.equal(gammaUrlFor("https://gamma-api.polymarket.com/events?slug=abc"), null);
  assert.equal(gammaUrlFor("http://gamma-api.polymarket.com/markets?slug=abc"), null);
});

test("an event resolves only when it holds exactly one market", async () => {
  const { marketFromGamma } = await import("../../agents/oracle/polymarket");
  assert.deepEqual(marketFromGamma([{ markets: [{ slug: "a" }] }], "event"), { slug: "a" });
  assert.equal(marketFromGamma([{ markets: [{ slug: "a" }, { slug: "b" }] }], "event"), null);
  assert.equal(marketFromGamma([{ markets: [] }], "event"), null);
  assert.equal(marketFromGamma([{}, {}], "market"), null);
});

test("Gamma close times parse from Postgres text and ISO", async () => {
  const { parseGammaTime, questionOverlap } = await import("../../agents/oracle/polymarket");
  assert.equal(parseGammaTime("2026-10-03 11:58:12.32312+00"), Date.parse("2026-10-03T11:58:12.323Z"));
  assert.equal(parseGammaTime("2026-10-03 11:58:12.32312+00:00:00"), Date.parse("2026-10-03T11:58:12.323Z"));
  assert.equal(parseGammaTime("2026-10-10T03:00:00Z"), Date.parse("2026-10-10T03:00:00Z"));
  assert.ok(Number.isNaN(parseGammaTime(undefined)));
  assert.equal(questionOverlap("Will the Fed cut rates?", "Per Polymarket (closes Oct 1): Will the Fed cut rates?"), 1);
  assert.ok(questionOverlap("Will the Fed cut rates?", "Will BTC close above $100k?") < 0.6);
});

test("Polymarket is final only when closed AND UMA-resolved", () => {
  const m = (extra: Record<string, unknown>) => [{ outcomes: JSON.stringify(["Yes", "No"]), outcomePrices: JSON.stringify(["1", "0"]), ...extra }];
  assert.deepEqual(parsePolymarketStatus(m({ closed: true, umaResolutionStatus: "resolved" })), { resolved: true, yesWon: true });
  assert.deepEqual(
    parsePolymarketStatus(m({ closed: true, umaResolutionStatus: "resolved", outcomePrices: JSON.stringify(["0", "1"]) })),
    { resolved: true, yesWon: false },
  );
  assert.deepEqual(parsePolymarketStatus(m({ closed: true, umaResolutionStatus: "disputed" })), { resolved: false, yesWon: null });
  assert.deepEqual(parsePolymarketStatus(m({ closed: false, umaResolutionStatus: "resolved" })), { resolved: false, yesWon: null });
  assert.deepEqual(
    parsePolymarketStatus(m({ closed: true, umaResolutionStatus: "resolved", outcomePrices: JSON.stringify(["0.5", "0.5"]) })),
    { resolved: true, yesWon: null },
  );
  // Older markets carry no UMA status: closed with prices at exactly 1/0 counts as resolved.
  assert.deepEqual(parsePolymarketStatus(m({ closed: true })), { resolved: true, yesWon: true });
  assert.deepEqual(parsePolymarketStatus(m({ closed: true, outcomePrices: JSON.stringify(["0", "0"]) })), { resolved: false, yesWon: null });
  assert.deepEqual(parsePolymarketStatus(m({ closed: true, outcomePrices: JSON.stringify(["0.97", "0.03"]) })), { resolved: false, yesWon: null });
  assert.equal(parsePolymarketStatus([]), null);
  assert.equal(parsePolymarketStatus([{}, {}]), null, "several markets: ambiguous");
});

test("alerts POST {text} to the webhook and never throw", async () => {
  const prev = process.env.ALERT_WEBHOOK_URL;
  const calls: Array<{ url: string; body: string }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response("ok");
  }) as unknown as typeof fetch;
  const failing = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  try {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/x";
    await alert("Claim #3 is DISPUTED", fake);
    assert.equal(calls[0].url, "https://hooks.example/x");
    assert.deepEqual(JSON.parse(calls[0].body), { text: "[mimir-oracle] Claim #3 is DISPUTED" });
    await alert("boom", failing);
    delete process.env.ALERT_WEBHOOK_URL;
    await alert("no webhook", fake);
    assert.equal(calls.length, 1, "no URL: stderr only");
  } finally {
    if (prev === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = prev;
  }
});
