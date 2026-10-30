import assert from "node:assert/strict";
import { test } from "node:test";

import { createPonsSources, toCandidate } from "../../lib/launch/robinhood/market";
import { createPonsShield } from "../../lib/launch/robinhood/shield";

const token = "0x1111111111111111111111111111111111111111";
const pool = "0x2222222222222222222222222222222222222222";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("Pons candidates keep the pool and technical feed reads oldest-first candles", async () => {
  const candidate = toCandidate({
    attributes: { address: pool, name: "PONS / WETH", base_token_price_native_currency: "0.01", reserve_in_usd: "100000", quote_token_price_usd: "2000", volume_usd: { h1: "50000" } },
    relationships: { base_token: { data: { id: `robinhood_${token}` } } },
  }, "dexscreener", Date.now());
  assert.equal(candidate?.pool, pool);

  const oldest = Array.from({ length: 30 }, (_, i) => [1_700_000_000 + i * 300, 1 + i * 0.01, 1.01 + i * 0.01, 0.99 + i * 0.01, 1 + i * 0.01, 100]);
  const newestFirst = [...oldest].reverse();
  const urls: string[] = [];
  const sources = createPonsSources({ fetch: async (url) => (urls.push(url), json({ data: { attributes: { ohlcv_list: newestFirst } } })) });
  const read = await sources.technical.read(candidate!);
  assert.equal(read?.bars, 30);
  assert.equal(read?.trend, "up");
  assert.match(urls[0]!, /\/pools\/0x2222+\/ohlcv\/minute\?aggregate=5&limit=300&currency=token$/);
});

test("Pons Shield adapter combines token info and trades, then caches the report", async () => {
  const urls: string[] = [];
  const trades = Array.from({ length: 12 }, (_, i) => ({ attributes: { kind: "buy", tx_from_address: `0x${String(i + 1).padStart(40, "0")}`, from_token_amount: String(0.01 + i * 0.003), to_token_amount: "100", block_timestamp: "2026-10-30T00:00:00Z" } }));
  const shield = createPonsShield({ fetch: async (url) => {
    urls.push(url);
    return url.includes("/tokens/")
      ? json({ data: { attributes: { holders: { count: 300, distribution_percentage: { top_10: "40" } }, developer_address: "0xdev", developer_holding_percentage: "2", gt_score: 60, twitter_handle: "pons" } } })
      : json({ data: trades });
  } });
  const candidate = { mint: token, pool };
  const first = await shield.check(candidate);
  const second = await shield.check(candidate);
  assert.equal(first?.score, 100);
  assert.deepEqual(second, first);
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => u.endsWith(`/tokens/${token}/info`)));
  assert.ok(urls.some((u) => u.endsWith(`/pools/${pool}/trades`)));
  assert.equal(await shield.check({ mint: token }), null);
});
