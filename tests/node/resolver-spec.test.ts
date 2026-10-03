import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateJsonSpec,
  evaluatePriceSpec,
  parseResolverSpec,
  priceSpecFromQuestion,
  readPath,
  resolverLine,
  winnerFor,
} from "../../lib/resolver-spec";

test("a settlement rule's resolver line parses, and junk does not", () => {
  const rule = `Settle from CoinGecko at the deadline.\n${resolverLine({ kind: "price", symbol: "BTC", op: ">", threshold: 100000 })}`;
  assert.deepEqual(parseResolverSpec(rule), { kind: "price", symbol: "BTC", op: ">", threshold: 100000 });

  assert.equal(parseResolverSpec("no resolver here"), null);
  assert.equal(parseResolverSpec('resolver: {"kind":"price","symbol":"BTC","op":"==","threshold":1}'), null);
  assert.equal(parseResolverSpec('resolver: {"kind":"json","url":"http://x","path":"a","op":"==","value":1}'), null, "https only");
  assert.equal(parseResolverSpec('resolver: {"kind":"json","url":"https://x","path":"a","op":">","value":"text"}'), null);
  assert.equal(parseResolverSpec("resolver: {not json}"), null);
});

const AT = 1_800_000_000_000;

test("price specs need every source on the same side", () => {
  const spec = { kind: "price", symbol: "BTC", op: ">", threshold: 100 } as const;
  const r = (priceUsd: number, source = "s") => ({ source, priceUsd, at: AT });
  const met = evaluatePriceSpec(spec, [r(101), r(102)], AT);
  assert.ok(met.determined && met.conditionMet);
  const unmet = evaluatePriceSpec(spec, [r(99), r(100)], AT);
  assert.ok(unmet.determined && !unmet.conditionMet, "exactly at the threshold is not above it");
  assert.equal(evaluatePriceSpec(spec, [r(99), r(101)], AT).determined, false);
  assert.equal(evaluatePriceSpec(spec, [r(101)], AT).determined, false);
});

test("price specs apply the cross-check's spread and age rules", () => {
  const spec = { kind: "price", symbol: "BTC", op: ">", threshold: 100 } as const;
  const wide = evaluatePriceSpec(spec, [{ source: "a", priceUsd: 101, at: AT }, { source: "b", priceUsd: 120, at: AT }], AT);
  assert.equal(wide.determined, false, "sources 16% apart do not settle");
  const stale = evaluatePriceSpec(spec, [{ source: "a", priceUsd: 101, at: AT - 60 * 60_000 }, { source: "b", priceUsd: 101, at: AT }], AT);
  assert.equal(stale.determined, false, "a reading an hour from the deadline is not about it");
  const untimed = evaluatePriceSpec(spec, [{ source: "a", priceUsd: 101, at: NaN }, { source: "b", priceUsd: 101, at: AT }], AT);
  assert.equal(untimed.determined, false);
});

test("DEX-priced tokens never settle through the structured resolver", () => {
  const ansem = { kind: "price", symbol: "ANSEM", op: ">", threshold: 0.01 } as const;
  const r = (source: string) => ({ source, priceUsd: 0.02, at: AT });
  assert.equal(evaluatePriceSpec(ansem, [r("dexscreener"), r("jupiter"), r("coingecko")], AT).determined, false);
  const btc = { kind: "price", symbol: "BTC", op: ">", threshold: 0.01 } as const;
  assert.equal(evaluatePriceSpec(btc, [r("dexscreener"), r("coingecko")], AT).determined, false, "any DEX reading disqualifies");
});

test("json specs read a path and compare", () => {
  const data = { data: { items: [{ score: 3, status: "FINAL" }] } };
  assert.equal(readPath(data, "data.items[0].score"), 3);
  assert.equal(readPath(data, "data.items[5].score"), undefined);

  const out = evaluateJsonSpec({ kind: "json", url: "https://x", path: "data.items[0].status", op: "==", value: "FINAL" }, data);
  assert.ok(out.determined && out.conditionMet);
  assert.equal(evaluateJsonSpec({ kind: "json", url: "https://x", path: "data.nope", op: "==", value: 1 }, data).determined, false);
});

test("numeric json comparisons need a number: 'pending' is not 'No'", () => {
  const spec = (op: ">" | "==", value: number) => ({ kind: "json" as const, url: "https://x", path: "v", op, value });
  assert.equal(evaluateJsonSpec(spec(">", 3), { v: "pending" }).determined, false);
  assert.equal(evaluateJsonSpec(spec(">", 3), { v: "" }).determined, false);
  assert.equal(evaluateJsonSpec(spec(">", 3), { v: true }).determined, false);
  assert.equal(evaluateJsonSpec(spec("==", 3), { v: "pending" }).determined, false);
  const ok = evaluateJsonSpec(spec(">", 3), { v: "4" });
  assert.ok(ok.determined && ok.conditionMet);
});

test("json specs are honoured only on allowlisted API hosts", async () => {
  const { effectiveResolverSpec, isTrustedJsonSpec } = await import("../../lib/resolver-spec");
  const j = (url: string) => ({ kind: "json" as const, url, path: "a", op: "==" as const, value: true });
  assert.equal(isTrustedJsonSpec(j("https://site.api.espn.com/apis/x")), true);
  // Gamma goes through the Polymarket binding checks; prices only through a price spec.
  assert.equal(isTrustedJsonSpec(j("https://gamma-api.polymarket.com/markets?slug=x")), false);
  assert.equal(isTrustedJsonSpec(j("https://api.coingecko.com/api/v3/x")), false);
  assert.equal(isTrustedJsonSpec(j("https://attacker.example/x.json")), false);
  assert.equal(isTrustedJsonSpec(j("https://site.api.espn.com.attacker.io/x")), false);
  assert.equal(isTrustedJsonSpec(j("https://site.api.espn.com:8443/x")), false);
  assert.equal(effectiveResolverSpec({ question: "Did it happen?", resolutionUrl: "https://attacker.example/x.json#mimir=json:eq:true:won" }), null);
  assert.equal(effectiveResolverSpec({ question: "Final?", resolutionUrl: "https://site.api.espn.com/x#mimir=json:eq:true:won" })?.kind, "json");
});

test("a price spec is ignored unless it matches the question", async () => {
  const { effectiveResolverSpec, priceSpecMatchesQuestion } = await import("../../lib/resolver-spec");
  const p = (symbol: string, op: ">" | "<", threshold: number) => ({ kind: "price" as const, symbol, op, threshold });
  assert.equal(priceSpecMatchesQuestion(p("SOL", ">", 250), "Will SOL trade above $250?"), true);
  assert.equal(priceSpecMatchesQuestion(p("SOL", "<", 250), "Will SOL trade above $250?"), false, "direction flipped");
  assert.equal(priceSpecMatchesQuestion(p("SOL", ">", 200), "Will SOL trade above $250?"), false, "threshold");
  assert.equal(priceSpecMatchesQuestion(p("ETH", ">", 250), "Will SOL trade above $250?"), false, "symbol");
  assert.equal(priceSpecMatchesQuestion(p("BTC", ">", 100000), "Will BTC close above $100k?"), true);
  assert.equal(priceSpecMatchesQuestion(p("SOL", ">", 100e9), "Will Solana's market cap be above $100B?"), false);
  assert.equal(effectiveResolverSpec({ question: "Will SOL trade above $250?", resolutionUrl: "https://flashapi.trade/prices/SOL#mimir=price:SOL:lt:250" }), null);
});

test("a met condition maps to a side only for Yes/No positions", () => {
  assert.equal(winnerFor(true, "Yes: momentum", "No"), "CREATOR_WINS");
  assert.equal(winnerFor(false, "Yes", "No"), "CHALLENGERS_WIN");
  assert.equal(winnerFor(true, "No", "Yes"), "CHALLENGERS_WIN");
  assert.equal(winnerFor(true, "Bulls", "Bears"), null);
});

test("the market creator only writes a spec for unambiguous thresholds", () => {
  assert.deepEqual(priceSpecFromQuestion("Will BTC close above $100k?", "BTC", 100000), { kind: "price", symbol: "BTC", op: ">", threshold: 100000 });
  assert.deepEqual(priceSpecFromQuestion("Will ETH trade below $2,000?", "ETH", 2000)?.op, "<");
  assert.equal(priceSpecFromQuestion("Will BTC reach $100k?", "BTC", 100000), null);
});

test("a spec round-trips through the resolution URL fragment (Solana claims)", async () => {
  const { resolverFromUrl, resolverSpecFor, stripResolverFragment, withResolverFragment } = await import("../../lib/resolver-spec");
  const price = { kind: "price", symbol: "BTC", op: ">", threshold: 83795.5 } as const;
  const url = withResolverFragment("https://flashapi.trade/prices/BTC", price);
  assert.equal(url, "https://flashapi.trade/prices/BTC#mimir=price:BTC:gt:83795.5");
  assert.deepEqual(resolverFromUrl(url), price);
  assert.equal(stripResolverFragment(url), "https://flashapi.trade/prices/BTC");

  const json = { kind: "json", url: "https://api.x.io/m/7", path: "data.status", op: "==", value: "FINAL" } as const;
  const jurl = withResolverFragment("https://api.x.io/m/7", json);
  assert.deepEqual(resolverFromUrl(jurl), json);
  assert.throws(() => withResolverFragment("https://other.io", json));

  assert.equal(resolverFromUrl("https://x.io/#mimir=price:BTC:eq:1"), null, "same validation as the rule line");
  assert.equal(resolverFromUrl("https://x.io/#mimir=junk"), null);
  assert.equal(resolverFromUrl("https://x.io/page#section"), null);
  assert.ok(url.length <= 200, "fits the on-chain resolution_url limit");
  assert.deepEqual(resolverSpecFor({ resolutionUrl: "https://x.io", settlementRule: 'resolver: {"kind":"price","symbol":"ETH","op":"<","threshold":2000}' })?.kind, "price");
});

test("the create form only offers deterministic settlement for clean price drafts", async () => {
  const { deterministicPriceOption } = await import("../../lib/resolver-spec");
  const src = (s: string) => `https://flashapi.trade/prices/${s}`;
  const ok = deterministicPriceOption({ question: "Will SOL trade above $250 on Friday?", creatorPosition: "Yes", counterPosition: "No", resolutionUrl: "", defaultSource: src });
  assert.equal(ok?.resolutionUrl, "https://flashapi.trade/prices/SOL#mimir=price:SOL:gt:250");
  assert.equal(deterministicPriceOption({ question: "Will SOL trade above $250?", creatorPosition: "Bulls", counterPosition: "Bears", resolutionUrl: "", defaultSource: src }), null);
  assert.equal(deterministicPriceOption({ question: "Will SOL reach $250?", creatorPosition: "Yes", counterPosition: "No", resolutionUrl: "", defaultSource: src }), null);
  assert.equal(deterministicPriceOption({ question: "Will ETH beat SOL above $250?", creatorPosition: "Yes", counterPosition: "No", resolutionUrl: "", defaultSource: src }), null);
});

test("== / != need the expected value's type: a string \"true\" is no answer to true", () => {
  const spec = (op: "==" | "!=", value: string | boolean | number) => ({ kind: "json" as const, url: "https://x", path: "v", op, value });
  assert.equal(evaluateJsonSpec(spec("==", true), { v: "true" }).determined, false);
  assert.equal(evaluateJsonSpec(spec("!=", true), { v: 1 }).determined, false);
  assert.equal(evaluateJsonSpec(spec("==", "FINAL"), { v: 1 }).determined, false);
  assert.equal(evaluateJsonSpec(spec("!=", "FINAL"), { v: false }).determined, false);
  assert.equal(evaluateJsonSpec(spec("==", 3), { v: true }).determined, false);
  const b = evaluateJsonSpec(spec("!=", true), { v: false });
  assert.ok(b.determined && b.conditionMet);
  const n = evaluateJsonSpec(spec("==", 3), { v: 3 });
  assert.ok(n.determined && n.conditionMet);
  const ns = evaluateJsonSpec(spec("==", 3), { v: "3" });
  assert.ok(ns.determined && ns.conditionMet, "a numeric string is a number");
});

test("an ESPN spec settles only once ESPN reports the event completed", async () => {
  const { espnEventCompleted } = await import("../../lib/resolver-spec");
  const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261003&event=1";
  const path = "events[0].competitions[0].competitors[0].winner";
  const board = (completed: unknown) => ({
    events: [{ status: { type: { completed } }, competitions: [{ competitors: [{ winner: true }] }] }],
  });
  const spec = { kind: "json" as const, url, path, op: "==" as const, value: true };
  assert.equal(evaluateJsonSpec(spec, board(false)).determined, false, "live game");
  assert.equal(evaluateJsonSpec(spec, board("true")).determined, false, "only boolean true");
  assert.equal(evaluateJsonSpec(spec, { events: [{ competitions: [{ competitors: [{ winner: true }] }] }] }).determined, false, "no status");
  const done = evaluateJsonSpec(spec, board(true));
  assert.ok(done.determined && done.conditionMet);
  // The completion is read for the event the path points at, not another one.
  const two = { events: [{ status: { type: { completed: true } } }, { status: { type: { completed: false } }, competitions: [{ competitors: [{ winner: true }] }] }] };
  assert.equal(evaluateJsonSpec({ ...spec, path: "events[1].competitions[0].competitors[0].winner" }, two).determined, false);
  // Summary payloads carry the status under header.competitions[0].
  assert.equal(espnEventCompleted({ header: { competitions: [{ status: { type: { completed: true } } }] } }, "header.competitions[0].competitors[0].winner"), true);
  assert.equal(espnEventCompleted({ header: { competitions: [{ status: { type: { completed: false } } }] }, status: { type: { completed: true } } }, "boxscore.x"), false);
  // Non-ESPN hosts are not gated by this (they are not honoured at all on the oracle path).
  assert.ok(evaluateJsonSpec({ ...spec, url: "https://x" }, board(false)).determined);
});

test("an ESPN game that had already kicked off when the claim was created never settles deterministically", () => {
  const spec = { kind: "json" as const, url: "https://site.api.espn.com/x", path: "events[0].competitions[0].competitors[0].winner", op: "==" as const, value: true };
  const data = (date: string) => ({
    events: [{ date, status: { type: { completed: true } }, competitions: [{ competitors: [{ winner: true }] }] }],
  });
  const created = Date.parse("2026-10-01T12:00:00Z");
  assert.equal(evaluateJsonSpec(spec, data("2026-10-01T18:00Z"), { claimCreatedAtMs: created }).determined, true);
  assert.equal(evaluateJsonSpec(spec, data("2026-10-01T10:00Z"), { claimCreatedAtMs: created }).determined, false);
});
