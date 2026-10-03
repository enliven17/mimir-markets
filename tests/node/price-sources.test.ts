import test from "node:test";
import assert from "node:assert/strict";

import { closestSample } from "../../lib/server/price-sources";

test("closestSample picks the sample nearest the target and skips junk", () => {
  const samples: Array<[number, number]> = [
    [1_000, 10],
    [2_000, 20],
    [2_600, NaN],
    [3_000, 30],
    [2_400, 0],
  ];
  assert.deepEqual(closestSample(samples, 2_450), [2_000, 20]);
  assert.deepEqual(closestSample(samples, 2_900), [3_000, 30]);
  assert.equal(closestSample([], 1), null);
});

test("lastRoundAtOrBefore finds the round that was current at the target time", async () => {
  const { lastRoundAtOrBefore } = await import("../../lib/server/chainlink");
  const times = [0, 100, 200, 300, 400, 500]; // index 1..5
  const at = async (i: number) => times[i];
  assert.equal(await lastRoundAtOrBefore(5, 250, at), 2);
  assert.equal(await lastRoundAtOrBefore(5, 500, at), 5);
  assert.equal(await lastRoundAtOrBefore(5, 99, at), -1);
  // A missing round (updatedAt 0) is never chosen.
  const gappy = async (i: number) => (i === 3 ? 0 : times[i]);
  assert.equal(await lastRoundAtOrBefore(5, 350, gappy), 2);
});

test("chainlink return values decode without an EVM library", async () => {
  const { abiString, abiWords, toSigned } = await import("../../lib/server/chainlink");
  // description() = "BTC / USD"
  const desc = "0x" + "20".padStart(64, "0") + "9".padStart(64, "0") + Buffer.from("BTC / USD").toString("hex").padEnd(64, "0");
  assert.equal(abiString(desc), "BTC / USD");
  assert.deepEqual(abiWords("0x" + "8".padStart(64, "0")), [8n]);
  assert.equal(toSigned((1n << 256n) - 5n), -5n);
  assert.equal(toSigned(42n), 42n);
});

test("settlement readings must sit within the deadline skew", async () => {
  const { readingsAt, MAX_DEADLINE_SKEW_MS } = await import("../../lib/server/price-sources");
  assert.equal(MAX_DEADLINE_SKEW_MS, 60_000);
  const at = 1_800_000_000_000;
  const r = (dt: number) => ({ source: "coingecko" as const, priceUsd: 1, at: at + dt });
  assert.deepEqual(readingsAt([r(0), r(59_000), r(-60_000), r(61_000), r(-5 * 60_000), { ...r(0), at: NaN }], at).map((x) => x.at - at), [0, 59_000, -60_000]);
});

test("each source keeps its own deadline skew: interval history and Chainlink rounds survive, stale live quotes do not", async () => {
  const { readingsAt, coingeckoHistorySkewMs } = await import("../../lib/server/price-sources");
  const at = 10_000_000_000;
  assert.equal(coingeckoHistorySkewMs(at, at + 3600_000), 150_000);
  assert.equal(coingeckoHistorySkewMs(at, at + 3 * 86_400_000), 1_800_000);
  const kept = readingsAt(
    [
      { source: "coingecko", priceUsd: 1, at: at - 140_000, maxSkewMs: 150_000 },
      { source: "coinmarketcap", priceUsd: 1, at: at + 160_000, maxSkewMs: 150_000 },
      { source: "chainlink", priceUsd: 1, at: at - 3_000_000, maxSkewMs: 3_600_000 },
      { source: "flashtrade", priceUsd: 1, at: at - 90_000 },
    ],
    at,
  );
  assert.deepEqual(kept.map((r) => r.source), ["coingecko", "chainlink"]);
});

test("a keyed NEXT_PUBLIC RPC is refused on mainnet unless declared origin-locked", async () => {
  const { assertPublicRpcUrl } = await import("../../lib/solana/config");
  assert.throws(() => assertPublicRpcUrl("X", "https://mainnet.helius-rpc.com/?api-key=abc", true, false), /key or query/);
  assert.doesNotThrow(() => assertPublicRpcUrl("X", "https://mainnet.helius-rpc.com/?api-key=abc", true, true));
  assert.doesNotThrow(() => assertPublicRpcUrl("X", "https://api.mainnet-beta.solana.com", true, false));
  assert.doesNotThrow(() => assertPublicRpcUrl("X", "https://x/?api-key=abc", false, false), "devnet untouched");
});
