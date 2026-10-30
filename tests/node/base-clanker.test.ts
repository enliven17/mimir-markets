import assert from "node:assert/strict";
import test from "node:test";

import { decodeAbiParameters } from "viem";
import { CLANKERS, WETH_ADDRESSES } from "clanker-sdk";

import { builderCodeSuffix, builderSuffixFromEnv, withBuilderSuffix } from "../../lib/base/builder-code";
import { BASE_WETH, CLANKER_FACTORY, CLANKER_FEE_LOCKER, CLANKER_LP_LOCKER, clankerFeesOn, clankerTokenConfig } from "../../lib/launch/base/clanker";
import { clankerDeployTx } from "../../lib/launch/base/deploy";
import { baseAgentPolicy } from "../../lib/launch/base/policy";
import { baseRound, baseRoundDue, BASE_CLAIM_EVERY_MS, type BaseAgent, type BaseRoundDeps } from "../../lib/launch/base/round";

const WALLET = "0x00000000000000000000000000000000000a9e17";
const PAYOUT = "0x00000000000000000000000000000000000bEEf1";

test("builder code: schema 0 bytes match ox / ERC-8021 (codes, length, schema 0, marker)", () => {
  // ox Attribution.toDataSuffix({ codes: ["baseapp"] })
  assert.equal(builderCodeSuffix(["baseapp"]), "0x62617365617070070080218021802180218021802180218021");
  assert.equal(builderSuffixFromEnv("baseapp"), builderCodeSuffix(["baseapp"]));
  assert.equal(builderSuffixFromEnv("0x62617365617070070080218021802180218021802180218021"), "0x62617365617070070080218021802180218021802180218021");
  assert.equal(builderSuffixFromEnv("0xdeadbeef"), null, "hex without the marker is not a suffix");
  assert.equal(builderSuffixFromEnv(""), null);
  assert.equal(builderSuffixFromEnv("bad,code"), null);
  assert.equal(withBuilderSuffix("0xabcd", "0x1234"), "0xabcd1234");
  assert.equal(withBuilderSuffix("0x", "0x1234"), "0x", "plain ETH sends stay plain");
  assert.equal(withBuilderSuffix("0xabcd", null), "0xabcd");
});

test("clanker: hardcoded Base addresses match clanker-sdk", () => {
  const v4 = CLANKERS.clanker_v4;
  assert.equal(v4.chainId, 8453);
  assert.equal(CLANKER_FACTORY, v4.address);
  assert.equal(CLANKER_FEE_LOCKER, v4.related.feeLocker);
  assert.equal(CLANKER_LP_LOCKER, v4.related.locker);
  assert.equal(BASE_WETH, WETH_ADDRESSES[8453]);
});

test("clanker: the agent is admin and sole reward recipient, paid in WETH, 1% static fee, no dev buy", async () => {
  const a = { wallet: WALLET, name: "Njord", symbol: "NJORD", image: "ipfs://x", description: "sea", website: "https://mimir.test", slug: "njord" };
  const cfg = clankerTokenConfig(a);
  assert.equal(cfg.tokenAdmin, WALLET);
  assert.deepEqual(cfg.rewards.recipients, [{ admin: WALLET, recipient: WALLET, bps: 10_000, token: "Paired" }]);
  assert.deepEqual(cfg.fees, { type: "static", clankerFee: 100, pairedFee: 100 });
  assert.ok(!("devBuy" in cfg) && !("vault" in cfg));

  const tx = await clankerDeployTx(a);
  assert.equal(tx.address, CLANKER_FACTORY);
  assert.equal(tx.value ?? 0n, 0n);
  assert.match(tx.expectedAddress ?? "", /^0x[0-9a-fA-F]{40}$/);
  const [d] = tx.args as [{ tokenConfig: { tokenAdmin: string; symbol: string }; lockerConfig: { rewardRecipients: string[]; rewardBps: number[]; lockerData: `0x${string}` }; poolConfig: { pairedToken: string }; extensionConfigs: unknown[] }];
  assert.equal(d.tokenConfig.tokenAdmin.toLowerCase(), WALLET);
  assert.equal(d.tokenConfig.symbol, "NJORD");
  assert.deepEqual(d.lockerConfig.rewardRecipients.map((r) => r.toLowerCase()), [WALLET]);
  assert.deepEqual(d.lockerConfig.rewardBps, [10_000]);
  assert.equal(d.poolConfig.pairedToken, BASE_WETH);
  assert.equal(d.extensionConfigs.length, 0, "no vault, airdrop or dev buy");
  // lockerData = abi.encode(struct{ uint8[] feePreference }): 1 = Paired.
  const [prefs] = decodeAbiParameters([{ type: "tuple", components: [{ type: "uint8[]", name: "feePreference" }] }], d.lockerConfig.lockerData);
  assert.deepEqual((prefs as { feePreference: readonly number[] }).feePreference, [1]);
});

test("clanker: fee math, 1% to the creator plus Clanker's 20% of it", () => {
  const f = clankerFeesOn(10);
  assert.equal(f.creator, 0.1);
  assert.ok(Math.abs(f.protocol - 0.02) < 1e-12);
  assert.ok(Math.abs(f.total - 0.12) < 1e-12);
});

test("base policy: pins Base, Clanker contracts, WETH unwrap only, pays only the payout and the treasury", () => {
  const p = baseAgentPolicy(WALLET, PAYOUT, null);
  assert.equal(p.chain_type, "ethereum");
  for (const r of p.rules) {
    assert.equal(r.action, "ALLOW");
    assert.deepEqual(r.conditions[0], { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "8453" });
  }
  const tos = p.rules.flatMap((r) => r.conditions.filter((c) => c.field === "to").flatMap((c) => (Array.isArray(c.value) ? c.value : [c.value])));
  assert.deepEqual(new Set(tos), new Set([CLANKER_FACTORY, CLANKER_FEE_LOCKER, BASE_WETH, PAYOUT].map((a) => a.toLowerCase())));
  const unwrap = p.rules.find((r) => r.conditions.some((c) => c.value === BASE_WETH.toLowerCase()))!;
  assert.ok(unwrap.conditions.some((c) => c.field === "function_name" && c.value === "withdraw"));
  const withTreasury = baseAgentPolicy(WALLET, PAYOUT, "0x00000000000000000000000000000000000000Aa");
  assert.ok(JSON.stringify(withTreasury).includes("0x00000000000000000000000000000000000000aa"));
});

function fakeRound(over: Partial<BaseRoundDeps> = {}) {
  const calls: string[] = [];
  const d: BaseRoundDeps = {
    claim: async () => (calls.push("claim"), { sig: "0xc1", wei: 5_000_000_000_000_000n }),
    spendable: async () => 20_000_000n,
    transfer: async (a) => (calls.push(`transfer:${a.to}:${a.gwei}`), "0xt1"),
    markClaimed: async () => void calls.push("markClaimed"),
    markSwept: async () => void calls.push("markSwept"),
    log: async (_id, kind, text) => void calls.push(`${kind}:${text}`),
    ...over,
  };
  return { d, calls };
}
const agent = (over: Partial<BaseAgent> = {}): BaseAgent => ({ id: "a1", ticker: "NJORD", walletId: "w1", wallet: WALLET, payout: PAYOUT, mint: "0xToken", status: "live", feesClaimedAt: null, swept: false, ...over });

test("base round: claims hourly into the wallet, never sweeps a live agent", async () => {
  const now = 10 * BASE_CLAIM_EVERY_MS;
  assert.equal(baseRoundDue(agent({ feesClaimedAt: now - 1000 }), now), false);
  assert.equal(baseRoundDue(agent({ mint: null }), now), false);
  const { d, calls } = fakeRound();
  const r = await baseRound(agent(), d, now);
  assert.equal(r.claimedWei, 5_000_000_000_000_000n);
  assert.equal(r.sweptGwei, 0n);
  assert.deepEqual(calls.slice(0, 2), ["markClaimed", "claim"]);
  assert.ok(calls.some((c) => c.startsWith("rules:claimed 0.005000 ETH")));
  assert.ok(!calls.some((c) => c.startsWith("transfer") || c === "markSwept"));
});

test("base round: shutdown claims, sends all spendable ETH to the payout address, then marks swept (even if the claim fails)", async () => {
  const now = Date.now();
  assert.equal(baseRoundDue(agent({ status: "killed", feesClaimedAt: now }), now), true);
  assert.equal(baseRoundDue(agent({ status: "killed", swept: true }), now), false);
  const ok = fakeRound();
  const r = await baseRound(agent({ status: "killed", feesClaimedAt: now }), ok.d, now);
  assert.equal(r.sweptGwei, 20_000_000n);
  assert.ok(ok.calls.includes(`transfer:${PAYOUT}:20000000`));
  assert.equal(ok.calls.at(-1), "markSwept");

  const bad = fakeRound({ claim: async () => { throw new Error("rpc down"); } });
  await baseRound(agent({ status: "killed" }), bad.d, now);
  assert.ok(bad.calls.some((c) => c.startsWith("error:creator fee claim failed")));
  assert.equal(bad.calls.at(-1), "markSwept");

  const dust = fakeRound({ spendable: async () => 5n });
  await baseRound(agent({ status: "killed" }), dust.d, now);
  assert.ok(!dust.calls.some((c) => c.startsWith("transfer")));
  assert.equal(dust.calls.at(-1), "markSwept");
});
