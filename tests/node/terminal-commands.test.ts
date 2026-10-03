import test from "node:test";
import assert from "node:assert/strict";

import { complete, parseCommand } from "../../lib/terminal/commands";
import { oddsBar, timeLeft, usd, usdc } from "../../lib/terminal/format";
import { parseJupiterToken } from "../../lib/server/token-info";

const MINT = "8r2Lgeg2aJzekpg1vLRJ2BoNUGKXqvH11Ab74eRPjd4V";

test("commands parse, with aliases and validation", () => {
  assert.deepEqual(parseCommand("markets live"), { kind: "markets", filter: "live" });
  assert.deepEqual(parseCommand("ls"), { kind: "markets", filter: "all" });
  assert.equal(parseCommand("markets moon")?.kind, "error");
  assert.deepEqual(parseCommand("market #42"), { kind: "market", id: 42 });
  assert.equal(parseCommand("market x")?.kind, "error");
  assert.deepEqual(parseCommand(`token ${MINT}`), { kind: "token", mint: MINT });
  assert.deepEqual(parseCommand(MINT), { kind: "token", mint: MINT }, "a pasted address is a lookup");
  assert.deepEqual(parseCommand(`buy ${MINT} 0.5`), { kind: "buy", mint: MINT, sol: 0.5 });
  assert.deepEqual(parseCommand(`buy ${MINT} 0.25sol`), { kind: "buy", mint: MINT, sol: 0.25 });
  assert.equal(parseCommand(`sell ${MINT} 150%`)?.kind, "error");
  assert.deepEqual(parseCommand(`sell ${MINT} 50%`), { kind: "sell", mint: MINT, pct: 50 });
  assert.deepEqual(parseCommand("limit revoke"), { kind: "limit", amount: 0, revoke: true });
  assert.deepEqual(parseCommand("limit 5"), { kind: "limit", amount: 5, revoke: false });
  assert.equal(parseCommand("   "), null);
});

test("with an agent selected, plain text is a question for it; without one it is an error", () => {
  assert.deepEqual(parseCommand("will SOL pump?", "socrates"), { kind: "ask", agent: "socrates", text: "will SOL pump?" });
  assert.equal(parseCommand("will SOL pump?")?.kind, "error");
  assert.deepEqual(parseCommand("ask Taleb is this fragile?"), { kind: "ask", agent: "taleb", text: "is this fragile?" });
  assert.equal(parseCommand("ask taleb")?.kind, "error");
  assert.deepEqual(parseCommand("use Socrates"), { kind: "use", agent: "socrates" });
});

test("tab completes command names first, then the given words", () => {
  assert.deepEqual(complete("mar"), ["markets", "market"]);
  assert.deepEqual(complete("use so", ["socrates", "statistician"]), ["socrates"]);
  assert.deepEqual(complete("markets"), ["market"].filter(() => false), "an exact name has nothing left to complete");
});

test("formatting: usdc, time left, odds bar, compact usd", () => {
  assert.equal(usdc("3000000"), "3");
  assert.equal(usdc(2_500_000), "2.5");
  const now = 1_000_000_000_000;
  assert.equal(timeLeft(now / 1000 + 2 * 86_400 + 4 * 3600, now), "2d 4h");
  assert.equal(timeLeft(now / 1000 + 45 * 60, now), "45m");
  assert.equal(timeLeft(now / 1000 - 1, now), "closed");
  assert.equal(oddsBar(3, 1, 4), "███░ 75%");
  assert.equal(oddsBar(0, 0, 4), "██░░ 50%");
  assert.equal(usd(18107.16), "$18.11K");
  assert.equal(usd(0.00001913), "$0.00001913");
  assert.equal(usd(null), "n/a");
});

test("a Jupiter token search answer is read for exactly the asked mint", () => {
  const body = [
    { id: "OTHER", name: "Impostor" },
    {
      id: MINT, name: "Mimir Markets", symbol: "MIMIR", usdPrice: 0.0000191, mcap: 18107, liquidity: 4249, holderCount: 183,
      organicScoreLabel: "medium", stats24h: { priceChange: -4.2, buyVolume: 1000, sellVolume: 500 },
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 27.2 },
    },
  ];
  const t = parseJupiterToken(body, MINT)!;
  assert.equal(t.name, "Mimir Markets");
  assert.equal(t.volume24hUsd, 1500);
  assert.equal(t.mintAuthorityDisabled, true);
  assert.equal(t.verified, null, "absent is unknown, not false");
  assert.equal(parseJupiterToken(body, "NOPE"), null);
});

test("typing previews the rest of a command: the name, then the arguments still to type", async () => {
  const { suggest } = await import("../../lib/terminal/commands");
  assert.equal(suggest("bu").ghost, "y <contract address> <sol>");
  assert.equal(suggest("buy ").ghost, "<contract address> <sol>");
  assert.equal(suggest(`buy ${MINT}`).ghost, " <sol>");
  assert.equal(suggest(`buy ${MINT} 0.1`).ghost, "");
  assert.deepEqual(suggest("mar").items.map((c) => c.name), ["markets", "market"]);
  assert.equal(suggest("will SOL pump").items.length, 0, "chat to an agent previews nothing");
  assert.equal(suggest("").items.length, 0);
});
