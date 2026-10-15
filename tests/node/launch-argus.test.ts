import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";

import { ARGUS, ARGUS_ABI, argusAllocation, claimSplit, decodeLaunch, encodeLaunch, hookAddressFor, launchParams, mineHookSalt, priceUsdc, tokenSalt } from "../../lib/launch/argus";
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
    { address: ARGUS.portal, topics: encodeEventTopics({ abi: ARGUS_ABI, eventName: "TokenCreated", args: { token, creator: CREATOR } }) as Hex[],
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }], ["Socrates", "SOCRATES", poolId, "ipfs://bafy", "", "", ""]) },
    { address: ARGUS.portal, topics: encodeEventTopics({ abi: ARGUS_ABI, eventName: "PartsDeployed", args: { token } }) as Hex[],
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
