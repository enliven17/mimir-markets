import test from "node:test";
import assert from "node:assert/strict";

import { clampBytes, draftProblem, isMimirTokenDraft, scoreDraft, toDeadline, type DraftClaim } from "../../agents/market-creator/draft";
import { cryptoDraft, skewedThreshold, thresholdProblem } from "../../agents/market-creator/crypto";
import { parseScoreboard, sportsDraft, SPORTS_LEAGUES } from "../../agents/market-creator/sports";
import { draftStockClaims, nextSessionClose } from "../../agents/market-creator/stocks";
import { filterDuplicates, normalizeSourceKey, signatureOf } from "../../agents/market-creator/dedupe";
import { summarizeInventory } from "../../agents/market-creator/inventory";
import { polymarketDraft, toCandidate } from "../../agents/market-creator/polymarket";
import { resolverFromUrl } from "../../lib/resolver-spec";

const NOW = Date.parse("2026-09-29T15:00:00.000Z"); // a Tuesday
const NOW_SEC = Math.floor(NOW / 1000);
const EPL = SPORTS_LEAGUES.find((l) => l.path === "soccer/eng.1")!;
const NBA = SPORTS_LEAGUES.find((l) => l.path === "basketball/nba")!;

function espnEvent(id: string, date: string, state = "pre") {
  return {
    id,
    date,
    status: { type: { state, completed: state === "post" } },
    competitions: [
      {
        competitors: [
          { homeAway: "home", team: { displayName: "Liverpool" } },
          { homeAway: "away", team: { displayName: "Arsenal" } },
        ],
      },
    ],
  };
}

test("fractional deadlines are floored to whole seconds", () => {
  assert.equal(toDeadline(1_800_000_000_999.7), 1_800_000_000);
  assert.ok(Number.isInteger(toDeadline(NOW + 0.5 * 3_600_000 + 0.3)));
});

test("clampBytes keeps multi-byte names inside the byte budget", () => {
  const out = clampBytes("Vinícius Júnior ".repeat(10), 40);
  assert.ok(Buffer.byteLength(out, "utf8") <= 40);
  assert.ok(out.endsWith("…"));
  assert.equal(clampBytes("short", 40), "short");
});

test("scoreboards keep only scheduled games inside the window", () => {
  const payload = {
    events: [
      espnEvent("1", new Date(NOW + 30 * 3_600_000).toISOString()),
      espnEvent("2", new Date(NOW + 1 * 3_600_000).toISOString()), // kickoff too close
      espnEvent("3", new Date(NOW + 100 * 3_600_000).toISOString()), // past the horizon
      espnEvent("4", new Date(NOW + 30 * 3_600_000).toISOString(), "in"),
      espnEvent("5", new Date(NOW + 30 * 3_600_000).toISOString(), "post"),
    ],
  };
  const games = parseScoreboard(payload, EPL, NOW, 72);
  assert.deepEqual(games.map((g) => g.id), ["1"]);
  assert.equal(games[0].home, "Liverpool");
});

test("a sports draft closes betting at kickoff and points at the one game", () => {
  const start = NOW + 30 * 3_600_000 + 123;
  const [game] = parseScoreboard({ events: [espnEvent("401", new Date(start).toISOString())] }, EPL, NOW, 72);
  const d = sportsDraft(game);
  assert.equal(d.deadline, Math.floor(start / 1000));
  assert.equal(d.category, "sports");
  assert.match(d.resolutionUrl, /soccer\/eng\.1\/scoreboard\?dates=20260930&event=401$/);
  assert.match(d.question, /^Will Liverpool beat Arsenal in their Premier League game on Sep 30, 2026\?$/);
  assert.match(d.counterPosition, /draw/);
  assert.equal(draftProblem(d, NOW_SEC), null);
  assert.ok(scoreDraft(d, NOW_SEC).score >= 60, "a scheduled game is decidable");

  const nba = sportsDraft({ ...game, league: NBA });
  assert.doesNotMatch(nba.counterPosition, /draw/);
});

test("stock claims settle after the New York close, skipping weekends", () => {
  const close = nextSessionClose(NOW);
  assert.equal(new Date(close).toISOString(), "2026-09-29T20:00:00.000Z"); // 16:00 EDT
  const saturday = Date.parse("2026-10-03T12:00:00.000Z");
  assert.equal(new Date(nextSessionClose(saturday)).toISOString(), "2026-10-05T20:00:00.000Z");
  // After DST ends the close is 21:00 UTC.
  assert.equal(new Date(nextSessionClose(Date.parse("2026-11-10T12:00:00.000Z"))).toISOString(), "2026-11-10T21:00:00.000Z");

  const [d] = draftStockClaims(1, NOW);
  assert.ok(d.deadline > Math.floor(close / 1000));
  assert.match(d.question, /close above its previous close on Sep 29, 2026\?$/);
  assert.match(d.resolutionUrl, /^https:\/\/stockanalysis\.com\/stocks\/[a-z]+\/$/);
  assert.equal(draftProblem(d, NOW_SEC), null);
  assert.ok(scoreDraft(d, NOW_SEC).score >= 60);
});

test("crypto drafts carry a price resolver and a sane threshold", () => {
  const threshold = skewedThreshold(100_000, "above");
  assert.equal(threshold, 100_300);
  assert.equal(thresholdProblem(threshold, 100_000), null);
  assert.match(thresholdProblem(500_000, 100_000) ?? "", /outside/);
  const d = cryptoDraft("BTC", threshold, "above", NOW + 30 * 60_000);
  const spec = resolverFromUrl(d.resolutionUrl);
  assert.equal(spec?.kind, "price");
  assert.equal(draftProblem(d, NOW_SEC), null);
  assert.ok(scoreDraft(d, NOW_SEC).score >= 60);
});

test("polymarket drafts pass the decidability floor", () => {
  const c = toCandidate(
    {
      question: "Will Benjamin Netanyahu be the next Prime Minister of Israel?",
      slug: "netanyahu-next-pm",
      endDate: new Date(NOW + 20 * 86_400_000).toISOString(),
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.3","0.7"]',
      liquidityNum: 50_000,
    },
    NOW,
  )!;
  const d = polymarketDraft(c)!;
  assert.ok(scoreDraft(d, NOW_SEC).score >= 60, JSON.stringify(scoreDraft(d, NOW_SEC)));
});

test("draftProblem enforces the program's byte limits", () => {
  const base: DraftClaim = {
    question: "Will X beat Y on Oct 1, 2026?",
    creatorPosition: "Yes",
    counterPosition: "No",
    category: "sports",
    resolutionUrl: "https://example.com/a",
    settlementRule: "",
    deadline: NOW_SEC + 3600,
    source: "espn",
    label: "x",
  };
  assert.equal(draftProblem(base, NOW_SEC), null);
  assert.match(draftProblem({ ...base, question: "é".repeat(101) }, NOW_SEC) ?? "", /question/);
  assert.match(draftProblem({ ...base, creatorPosition: "a".repeat(101) }, NOW_SEC) ?? "", /position/);
  assert.match(draftProblem({ ...base, deadline: NOW_SEC + 3600.5 }, NOW_SEC) ?? "", /whole seconds/);
  assert.match(draftProblem({ ...base, deadline: NOW_SEC }, NOW_SEC) ?? "", /too close/);
});

test("the house never drafts a claim on the $MIMIR token, on any cluster", () => {
  const base: DraftClaim = {
    question: "Will $SOL trade above $200 at the deadline?",
    creatorPosition: "Yes",
    counterPosition: "No",
    category: "crypto",
    resolutionUrl: "https://example.com/a",
    settlementRule: "",
    deadline: NOW_SEC + 3600,
    source: "flash",
    label: "x",
  };
  assert.equal(draftProblem(base, NOW_SEC), null);
  assert.equal(isMimirTokenDraft({ ...base, question: "Will Mimir Markets ship v4 by Friday?" }), false, "the product name is fine");
  assert.match(draftProblem({ ...base, question: "Will $MIMIR trade above $0.01 at the deadline?" }, NOW_SEC) ?? "", /MIMIR/);
  assert.match(draftProblem({ ...base, creatorPosition: "Yes: $mimir pumps" }, NOW_SEC) ?? "", /MIMIR/);
  assert.match(
    draftProblem({ ...base, resolutionUrl: "https://api.dexscreener.com/x#mimir=price:MIMIR:gt:0.01" }, NOW_SEC) ?? "",
    /MIMIR/,
    "a price spec on the token, whatever the question says",
  );
});

test("the source key keeps the query and drops the resolver fragment", () => {
  assert.equal(
    normalizeSourceKey("https://flashapi.trade/prices/BTC#mimir=price:BTC:gt:100"),
    normalizeSourceKey("https://flashapi.trade/prices/BTC"),
  );
  assert.notEqual(
    normalizeSourceKey("https://gamma-api.polymarket.com/markets?slug=a"),
    normalizeSourceKey("https://gamma-api.polymarket.com/markets?slug=b"),
  );
  assert.equal(normalizeSourceKey("https://www.stockanalysis.com/stocks/aapl/"), "https://stockanalysis.com/stocks/aapl");
});

test("duplicates of joinable claims and within a run are dropped", () => {
  const mk = (question: string, url: string, category = "sports") => ({ question, resolutionUrl: url, category, label: question });
  const existing = [signatureOf(mk("Will Liverpool beat Arsenal?", "https://espn.test/s?event=1"), "#7")];
  const drops: string[] = [];
  const kept = filterDuplicates(
    [
      mk("Will the Liverpool beat Arsenal", "https://espn.test/s?event=9"), // same question, normalised
      mk("Will Chelsea beat Spurs?", "https://espn.test/s?event=1"), // same source
      mk("Will Leeds beat Everton?", "https://espn.test/s?event=2"),
      mk("Will Leeds beat Everton?", "https://espn.test/s?event=3"), // repeat within the run
      mk("Will Leeds beat Everton?", "https://espn.test/s?event=2", "custom"), // other category
    ],
    existing,
    (_d, why) => drops.push(why),
  );
  assert.deepEqual(kept.map((k) => `${k.category}:${k.resolutionUrl}`), [
    "sports:https://espn.test/s?event=2",
    "custom:https://espn.test/s?event=2",
  ]);
  assert.match(drops[0], /same question as #7/);
  assert.match(drops[1], /same source as #7/);
});

test("inventory and dedupe count only the house's own joinable claims and cancel only own empty expired ones", () => {
  const me = "Me111111111111111111111111111111";
  const other = "Other1111111111111111111111111111";
  const claim = (id: number, over: Record<string, unknown>) =>
    ({
      id: BigInt(id),
      creator: { toBase58: () => me },
      question: `q${id}`,
      resolutionUrl: `https://x.test/${id}`,
      category: "crypto",
      deadline: NOW_SEC + 600,
      state: 0,
      challengers: [],
      ...over,
    }) as any;
  const inv = summarizeInventory(
    [
      claim(1, {}), // joinable
      claim(2, { state: 1, creator: { toBase58: () => other } }), // joinable, someone else's
      claim(3, { deadline: NOW_SEC - 10 }), // own, expired, empty → cancel
      claim(4, { deadline: NOW_SEC - 10, challengers: [{}] }), // expired but challenged
      claim(5, { deadline: NOW_SEC - 10, creator: { toBase58: () => other } }), // not ours
      claim(6, { state: 3 }), // cancelled
    ],
    me,
    NOW_SEC,
  );
  // #2 is someone else's: it neither fills the cap nor blocks a house draft as a duplicate (audit P2-3).
  assert.equal(inv.joinable, 1);
  assert.deepEqual(inv.signatures.map((s) => s.label), ["#1"]);
  assert.deepEqual(inv.expiredEmpty, [3n]);
});
