import test from "node:test";
import assert from "node:assert/strict";

import { esc, LINK_CODE_PATTERN, newMarketText, notificationText, telegramLinkMessage } from "../../lib/telegram";
import { SIDE_CHALLENGERS, SIDE_UNRESOLVABLE } from "../../lib/solana/config";

const event = (kind: string, payload: Record<string, unknown>) =>
  ({ recipient: "W", claimId: 7, kind, dedupe: kind, payload: { question: "Will <b>SOL</b> > $250?", ...payload } }) as never;

test("bet results read as won / lost / refunded, with the question escaped", () => {
  assert.match(notificationText(event("resolved", { winnerSide: SIDE_CHALLENGERS, youWon: true }))!, /You won/);
  assert.match(notificationText(event("resolved", { winnerSide: SIDE_CHALLENGERS, youWon: false }))!, /You lost/);
  assert.match(notificationText(event("resolved", { winnerSide: SIDE_UNRESOLVABLE, youWon: null }))!, /Refunded/);
  assert.ok(notificationText(event("resolved", { winnerSide: SIDE_CHALLENGERS, youWon: true }))!.includes("&lt;b&gt;SOL&lt;/b&gt; &gt; $250"));
  assert.equal(notificationText(event("challenged", {})), null, "not forwarded");
});

test("the link message binds wallet and code; codes are long and URL-safe", () => {
  assert.equal(telegramLinkMessage("W1", "c0de"), "Mimir Telegram link\nWallet: W1\nCode: c0de");
  assert.equal(LINK_CODE_PATTERN.test("A".repeat(24)), true);
  assert.equal(LINK_CODE_PATTERN.test("short"), false);
  assert.equal(LINK_CODE_PATTERN.test("x".repeat(20) + "<"), false);
});

test("a new market message escapes user text", () => {
  const text = newMarketText({ id: 1, question: "a & b <script>", creatorStake: "2000000", deadline: 1_800_000_000 });
  assert.ok(text.includes(esc("a & b <script>")));
  assert.match(text, /2 USDC/);
});

test("/price reads the deepest pair, with no settlement liquidity floor, and formats it", async () => {
  const { parseDexStats } = await import("../../lib/server/dex-prices");
  const { priceText, pumpFunUrl } = await import("../../lib/telegram");
  const mint = "8r2Lgeg2aJzekpg1vLRJ2BoNUGKXqvH11Ab74eRPjd4V";
  const stats = parseDexStats(
    [
      { chainId: "solana", baseToken: { address: mint }, priceUsd: "0.00001", liquidity: { usd: 500 } },
      { chainId: "solana", baseToken: { address: mint }, priceUsd: "0.00001846", liquidity: { usd: 10374 }, marketCap: 17475, volume: { h24: 34694 }, priceChange: { h24: -43.05 }, url: "https://dexscreener.com/solana/x" },
      { chainId: "base", baseToken: { address: mint }, priceUsd: "9", liquidity: { usd: 1e9 } },
    ],
    mint,
  );
  assert.equal(stats?.priceUsd, 0.00001846);
  assert.equal(stats?.pairUrl, "https://dexscreener.com/solana/x");
  const text = priceText("MIMIR", stats!);
  assert.match(text, /\$MIMIR<\/b> \$0\.00001846 \(▼ 43\.05% 24h\)/);
  assert.match(text, /Market cap: \$17\.48K/);
  assert.equal(pumpFunUrl(mint), `https://pump.fun/coin/${mint}`);
});
