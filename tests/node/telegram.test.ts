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

test("each wallet alert answers to its own switch; new markets have theirs", async () => {
  const { prefForKind, alertsKeyboard, ALERT_PREFS } = await import("../../lib/telegram");
  assert.equal(prefForKind("resolved"), "alert_results");
  assert.equal(prefForKind("cancelled"), "alert_results");
  assert.equal(prefForKind("proposed"), "alert_verdicts");
  assert.equal(prefForKind("payout_claimable"), "alert_payouts");
  assert.equal(prefForKind("challenged"), null);
  const kb = alertsKeyboard({ new_markets: false, alert_results: true, alert_verdicts: true, alert_payouts: false });
  assert.equal(kb.inline_keyboard.length, ALERT_PREFS.length);
  assert.match(kb.inline_keyboard[0][0].text, /^⬜ New markets/);
  assert.match(kb.inline_keyboard[1][0].text, /^✅ Results/);
  assert.equal(kb.inline_keyboard[1][0].callback_data, "alert:alert_results");
});

async function withFakeDb<T>(rows: (sql: string) => unknown[], fn: (log: Array<{ sql: string; args: unknown[] }>) => Promise<T>): Promise<T> {
  const log: Array<{ sql: string; args: unknown[] }> = [];
  const pool = { async query(sql: string, args: unknown[] = []) { const flat = sql.replace(/\s+/g, " ").trim(); log.push({ sql: flat, args }); return { rows: rows(flat) }; } };
  const g = globalThis as Record<string, unknown>;
  const prev = { url: process.env.DATABASE_URL, pool: g.__mimirSolanaPool, ready: g.__mimirSolanaDbReady, tok: process.env.TELEGRAM_BOT_TOKEN };
  process.env.DATABASE_URL = "postgres://fake";
  g.__mimirSolanaPool = pool;
  g.__mimirSolanaDbReady = Promise.resolve(pool);
  try {
    return await fn(log);
  } finally {
    if (prev.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev.url;
    g.__mimirSolanaPool = prev.pool;
    g.__mimirSolanaDbReady = prev.ready;
  }
}

test("a settlement alert only reaches chats that keep results on, whatever their new-market switch", async () => {
  const { deliverTelegram } = await import("../../lib/server/telegram");
  await withFakeDb(() => [], async (log) => {
    await deliverTelegram({ recipient: "W", claimId: 1, kind: "resolved", dedupe: "r", payload: { question: "q", winnerSide: 1, youWon: true } } as never);
    assert.match(log[0].sql, /WHERE wallet = \$1 AND NOT blocked AND alert_results$/);
    assert.doesNotMatch(log[0].sql, /new_markets/);
  });
});

test("an unknown alert key never reaches SQL", async () => {
  const { toggleAlertPref } = await import("../../lib/server/telegram");
  await withFakeDb(() => [], async (log) => {
    await assert.rejects(() => toggleAlertPref(1, "wallet = 'x'; --"), /unknown alert/);
    assert.equal(log.length, 0);
  });
});
