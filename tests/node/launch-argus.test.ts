import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";

import { ARGUS, ARGUS_ABI, argusAllocation, claimSplit, decodeLaunch, encodeLaunch, hookAddressFor, launchParams, mineHookSalt, priceUsdc, tokenSalt } from "../../lib/launch/argus";
import { argusFeeRound, feeKey, ZERO_FEES, type ArgusFeeAgent, type ArgusFeeDeps, type ArgusFeeState } from "../../lib/launch/argus-fees";
import { DEFAULT_ALLOCATION } from "../../lib/launch/fees";

const CREATOR = "0xc88124fd6cb8eb4c4e4b0c07f51246023044ff37";
const INIT_HASH = keccak256("0x1234");
const input = { name: "Socrates", symbol: "socrates", description: "d", imageURI: "ipfs://bafy", buyTaxBps: 200, sellTaxBps: 200, split: DEFAULT_ALLOCATION };

test("argusAllocation maps the owner's buyback to burnBps and the rest to the agent wallet", () => {
  assert.deepEqual(argusAllocation(DEFAULT_ALLOCATION), { creatorBps: 8444, burnBps: 1556, dividendBps: 0, liquidityBps: 0 });
  assert.deepEqual(argusAllocation({ bankroll: 100, buyback: 0, creatorPayout: 0, holders: 0 }), { creatorBps: 10000, burnBps: 0, dividendBps: 0, liquidityBps: 0 });
  assert.throws(() => argusAllocation({ bankroll: 50, buyback: 20, creatorPayout: 20, holders: 0 }), /summing to 100/);
  assert.throws(() => argusAllocation({ bankroll: 50, buyback: 20, creatorPayout: 20, holders: 10 }), /holders/);
});

test("claimSplit keeps platform and AI at 10% of all revenue and the owner's payout at 70% x its bucket", () => {
  // Revenue 1,000,000: Argus takes 100,000; the agent wallet's claim is 0.9 x 0.8444 of revenue.
  const s = claimSplit(759_960n, 8444, DEFAULT_ALLOCATION);
  assert.equal(s.platform, 100_000n);
  assert.equal(s.ai, 100_000n);
  assert.equal(s.payout, 140_000n);
  assert.equal(s.platform + s.ai + s.payout + s.bankroll, 759_960n);
  assert.deepEqual(claimSplit(0n, 8444, DEFAULT_ALLOCATION), { platform: 0n, ai: 0n, bankroll: 0n, payout: 0n });
});

test("launchParams validates and fills the Argus defaults", () => {
  const { p, meta } = launchParams(input);
  assert.equal(p.symbol, "SOCRATES");
  assert.equal(p.quoteAsset, ARGUS.usdc);
  assert.equal(p.devBuyQuote, 0n);
  assert.equal(p.creatorBps + p.burnBps + p.dividendBps + p.liquidityBps, 10000);
  assert.equal(meta.imageURI, "ipfs://bafy");
  assert.throws(() => launchParams({ ...input, buyTaxBps: 0, sellTaxBps: 0 }), /above 0/);
  assert.throws(() => launchParams({ ...input, sellTaxBps: 1001 }), /0 to 10%/);
  assert.throws(() => launchParams({ ...input, symbol: "x" }), /ticker/);
  assert.throws(() => launchParams({ ...input, imageURI: "http://x" }), /image/);
});

test("mineHookSalt finds a hook with exactly the 0x2044 flag bits, deterministically", () => {
  const seed = tokenSalt("council-socrates");
  const a = mineHookSalt(CREATOR, INIT_HASH, seed);
  assert.equal(Number(BigInt(a.hook) & 0x3fffn), 0x2044);
  assert.equal(hookAddressFor(CREATOR, a.hookSalt, INIT_HASH), a.hook);
  assert.deepEqual(mineHookSalt(CREATOR, INIT_HASH, seed), a);
  assert.notEqual(mineHookSalt(CREATOR, INIT_HASH, tokenSalt("other")).hookSalt, a.hookSalt);
});

test("encodeLaunch round-trips and decodeLaunch reads the Portal's events", () => {
  const params = launchParams(input);
  const salt = tokenSalt("x"), hookSalt = keccak256("0x01");
  const { functionName, args } = decodeFunctionData({ abi: ARGUS_ABI, data: encodeLaunch(params, salt, hookSalt) });
  assert.equal(functionName, "launch");
  assert.equal((args as readonly unknown[])[2], salt);

  const token = "0x9BBde5ef54604e06524605b42b20120Ab366E8DD", poolId: Hex = keccak256("0x02");
  const hook = "0x2Eab7E25EdACd4c3ba8C378c0Bb20eAA6E046044", locker = "0x1111111111111111111111111111111111111111", splitter = "0xAb7AC90eC5f1fcE657265E03469671fb0A71309A";
  const logs = [
    { address: ARGUS.portal, topics: encodeEventTopics({ abi: ARGUS_ABI, eventName: "TokenCreated", args: { token, creator: CREATOR } }) as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }], ["Socrates", "SOCRATES", poolId, "ipfs://bafy", "", "", ""]) },
    { address: ARGUS.portal, topics: encodeEventTopics({ abi: ARGUS_ABI, eventName: "PartsDeployed", args: { token } }) as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [locker, hook, splitter]) },
  ];
  assert.deepEqual(decodeLaunch(logs), { token, poolId, hook, locker, splitter });
  assert.equal(decodeLaunch(logs.map((l) => ({ ...l, address: locker }))), null);
});

test("priceUsdc reads USDC per token from sqrtPriceX96 with USDC as currency0", () => {
  // 1 token = 0.0000025 USDC (the $2,500 FDV open): currency1 (token raw) per currency0 (USDC raw) = 1e18 / 2.5 = 4e17.
  const sqrt = BigInt(Math.round(Math.sqrt(4e17) * 2 ** 96));
  const p = priceUsdc(sqrt, "0x9BBde5ef54604e06524605b42b20120Ab366E8DD");
  assert.ok(Math.abs(p - 2.5e-6) / 2.5e-6 < 1e-9);
  assert.equal(priceUsdc(0n, ARGUS.usdc), 0);
});

// ───────────────────────────── the fee round

function feeHarness(over: Partial<ArgusFeeDeps> = {}, fees: ArgusFeeState | null = null) {
  const sent: Array<{ kind: string; key: string; amount?: bigint }> = [];
  const agent: ArgusFeeAgent = { id: "a1", ticker: "SOC", walletId: "w", wallet: CREATOR, splitter: "0xs", locker: "0xl", creatorBps: 8444, split: DEFAULT_ALLOCATION, fees };
  const deps: ArgusFeeDeps = {
    claimable6: async () => 759_960_000n,
    poke: async () => undefined,
    submitClaim: async (_a, key) => (sent.push({ kind: "claim", key }), `c${sent.length}`),
    submitTreasury: async (_a, amount, key) => (sent.push({ kind: "treasury", key, amount }), `c${sent.length}`),
    state: async () => ({ state: "pending" }),
    wait: async (id) => `0xtx${id}`,
    save: async () => undefined,
    event: async () => undefined,
    now: 100 * 86_400_000, intervalMs: 86_400_000, minClaim6: 2_000_000n, minTreasury6: 1_000_000n,
    ...over,
  };
  return { agent, deps, sent };
}

test("a fee round claims, books Mimir's 20% of revenue as owed, then sends it to the treasury", async () => {
  const h = feeHarness();
  const f = await argusFeeRound(h.agent, h.deps);
  assert.deepEqual(h.sent.map((s) => s.kind), ["claim", "treasury"]);
  assert.equal(h.sent[1].amount, 200_000_000n); // 10% platform + 10% AI of 1,000 USDC revenue
  assert.equal(f.claimed6, "759960000");
  assert.equal(f.owedTreasury6, "0");
  assert.equal(f.paidTreasury6, "200000000");
  assert.equal(f.pending, undefined);
});

test("an unconfirmed send stays pending and is settled next round, never sent twice", async () => {
  const h = feeHarness({ wait: async () => { throw new Error("timeout"); } });
  const f1 = await argusFeeRound(h.agent, h.deps);
  assert.equal(f1.pending?.step, "claim");
  assert.equal(h.sent.length, 1);
  // Next round, still in flight: nothing new is sent.
  const f2 = await argusFeeRound({ ...h.agent, fees: f1 }, { ...h.deps, now: h.deps.now + 3_600_000 });
  assert.deepEqual(f2, f1);
  assert.equal(h.sent.length, 1);
  // Then Circle reports it done: booked once, and the treasury share goes out.
  const h2 = feeHarness({ state: async () => ({ state: "done", txHash: "0xabc" }) });
  const f3 = await argusFeeRound({ ...h2.agent, fees: f1 }, { ...h2.deps, now: h.deps.now + 7_200_000 });
  assert.deepEqual(h2.sent.map((s) => s.kind), ["treasury"]);
  assert.equal(f3.claimed6, "759960000");
  assert.equal(f3.paidTreasury6, "200000000");
});

test("a failed send is dropped and nothing is booked; the interval and minimum gate the claim", async () => {
  const fees: ArgusFeeState = { ...ZERO_FEES, owedTreasury6: "500000", lastRoundAt: 100 * 86_400_000, pending: { step: "treasury", circleId: "x", amount6: "500000", at: 0 } };
  const h = feeHarness({ state: async () => ({ state: "failed", reason: "DENIED" }) }, fees);
  const f = await argusFeeRound(h.agent, h.deps);
  assert.equal(f.pending, undefined);
  assert.equal(f.owedTreasury6, "500000");
  assert.equal(h.sent.length, 0); // claimed today already, and 0.5 USDC owed is under the minimum
  const small = feeHarness({ claimable6: async () => 1_000_000n });
  await argusFeeRound(small.agent, small.deps);
  assert.equal(small.sent.length, 0);
});

test("feeKey is a stable UUID per ledger step", () => {
  assert.match(feeKey("a1", "treasury", "0"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(feeKey("a1", "treasury", "0"), feeKey("a1", "treasury", "0"));
  assert.notEqual(feeKey("a1", "treasury", "0"), feeKey("a1", "treasury", "200000000"));
});
