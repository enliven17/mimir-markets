import test from "node:test";
import assert from "node:assert/strict";

import { CAPTION_MAX, cardModel, cardTypeFor, cardUrl, clampText, parseCardQuery, trimCaption, usdcText } from "../../lib/telegram-card";

const q = (type: string, query: string) => parseCardQuery(type, new URLSearchParams(query));
const market = {
  kind: "vs" as const,
  marketId: 12,
  question: "Will BTC trade above $83,000 at the deadline?",
  labelA: "Yes",
  labelB: "No",
  category: "crypto",
  stakeA: "3000000000000000000",
  stakeB: "1000000000000000000",
  participants: 3,
  deadline: 1_791_400_000,
  winner: 2,
  disputableUntil: 1_791_403_600,
  verdict: { confidence: 91 },
};

test("card requests are validated", () => {
  assert.deepEqual(q("won", "kind=vs&id=12&side=2"), { type: "won", kind: "vs", id: 12, side: 2 });
  assert.deepEqual(q("new", "kind=pool&id=3&v=1"), { type: "new", kind: "pool", id: 3, side: 0 });
  assert.equal(q("winning", "kind=vs&id=1"), null, "unknown type");
  assert.equal(q("new", "kind=evm&id=1"), null, "unknown kind");
  assert.equal(q("new", "kind=vs&id=0"), null);
  assert.equal(q("new", "kind=vs&id=1e3"), null);
  assert.equal(q("new", "kind=vs&id=-4"), null);
  assert.equal(q("new", "kind=vs&id=1234567890"), null, "too long");
  assert.equal(q("won", "kind=vs&id=1&side=3"), null);
  assert.equal(q("new", "kind=vs"), null);
});

test("card URLs carry the version and only a real side", () => {
  assert.equal(cardUrl("won", "vs", 12, 2, "https://x.test"), "https://x.test/api/telegram/card/won?kind=vs&id=12&side=2&v=1");
  assert.equal(cardUrl("new", "pool", 3, 0, "https://x.test"), "https://x.test/api/telegram/card/new?kind=pool&id=3&v=1");
});

test("each event maps to its card from the holder's side", () => {
  assert.equal(cardTypeFor({ type: "new", winner: 0 }, 1), "new");
  assert.equal(cardTypeFor({ type: "proposed", winner: 2 }, 1), "proposed");
  assert.equal(cardTypeFor({ type: "cancelled", winner: 0 }, 1), "cancelled");
  assert.equal(cardTypeFor({ type: "resolved", winner: 2 }, 2), "won");
  assert.equal(cardTypeFor({ type: "resolved", winner: 2 }, 1), "lost");
  assert.equal(cardTypeFor({ type: "resolved", winner: 4 }, 1), "refunded");
});

test("the card model reads the market", () => {
  assert.equal(usdcText("1234567000000000000"), "1.23");
  const won = cardModel({ type: "won", kind: "vs", id: 12, side: 2 }, market);
  assert.equal(won.headline, "You won");
  assert.equal(won.tone, "win");
  assert.deepEqual(won.sides.map((s) => [s.pct, s.lead, s.tag]), [[75, false, null], [25, true, "Your side"]]);
  assert.deepEqual(won.footer, ["3 participants", "4.00 USDC staked"]);
  const proposed = cardModel({ type: "proposed", kind: "vs", id: 12, side: 0 }, market);
  assert.match(proposed.detail, /^“No” · 91% sure · disputable until/);
  assert.equal(proposed.sides[1].tag, "Proposed");
  assert.equal(cardModel({ type: "new", kind: "vs", id: 12, side: 0 }, market).sides.some((s) => s.lead), false);
});

test("long questions are clamped on a word", () => {
  const long = "word ".repeat(80);
  const out = clampText(long, 150);
  assert.ok(out.length <= 150 && out.endsWith("…"));
  assert.equal(clampText("short one", 150), "short one");
});

test("captions stay within Telegram's limit with balanced HTML", () => {
  const short = "<b>New market</b>\nHi";
  assert.equal(trimCaption(short), short);
  const long = `<b>Result proposed</b> ${"x &amp; y ".repeat(200)}<i>${"z".repeat(300)}</i>`;
  const out = trimCaption(long);
  assert.ok(out.length <= CAPTION_MAX, `length ${out.length}`);
  assert.ok(!/&[a-z0-9#]*…/i.test(out), "no cut entity");
  const opened = (out.match(/<(b|i)>/g) ?? []).length;
  const closed = (out.match(/<\/(b|i)>/g) ?? []).length;
  assert.equal(opened, closed);
  const cutInBold = trimCaption(`<b>${"a".repeat(2000)}</b>`);
  assert.ok(cutInBold.endsWith("…</b>"));
});

test("a photo that cannot be sent falls back to the text", async () => {
  const { sendPhotoTo } = await import("../../lib/server/telegram");
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const realFetch = globalThis.fetch;
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  let mode: "ok" | "fail" | "busy" = "ok";
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const method = String(url).split("/").pop()!;
    calls.push({ method, body: JSON.parse(String(init.body)) });
    if (method === "sendMessage") return reply(200, { ok: true, result: {} });
    if (mode === "fail") return reply(400, { ok: false, description: "Bad Request: wrong file identifier/HTTP URL specified" });
    if (mode === "busy" && calls.filter((c) => c.method === "sendPhoto").length === 1) return reply(429, { ok: false, parameters: { retry_after: 0 } });
    return reply(200, { ok: true, result: { photo: [{ file_id: "small" }, { file_id: "big" }] } });
  }) as typeof fetch;
  try {
    assert.equal(await sendPhotoTo(1, "https://x.test/card.png", "<b>hi</b>"), "big");
    assert.deepEqual(calls.map((c) => c.method), ["sendPhoto"]);
    assert.equal(calls[0].body.caption, "<b>hi</b>");

    calls.length = 0;
    mode = "fail";
    assert.equal(await sendPhotoTo(1, "https://x.test/card.png", "<b>hi</b>", { reply_markup: { k: 1 } }), null);
    assert.deepEqual(calls.map((c) => c.method), ["sendPhoto", "sendMessage"]);
    assert.equal(calls[1].body.text, "<b>hi</b>");
    assert.deepEqual(calls[1].body.reply_markup, { k: 1 });

    calls.length = 0;
    mode = "busy";
    assert.equal(await sendPhotoTo(1, "https://x.test/card.png", "<b>hi</b>"), "big");
    assert.deepEqual(calls.map((c) => c.method), ["sendPhoto", "sendPhoto"]);
  } finally {
    globalThis.fetch = realFetch;
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
  }
});
