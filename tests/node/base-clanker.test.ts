import assert from "node:assert/strict";
import test from "node:test";

import { decodeAbiParameters, decodeFunctionData, type Abi } from "viem";
import { CLANKERS, WETH_ADDRESSES } from "clanker-sdk";

import { builderCodeSuffix, builderSuffixFromEnv, withBuilderSuffix } from "../../lib/base/builder-code";
import { Clanker } from "clanker-sdk/v4";
import { BASE_WETH, CLANKER_FACTORY, CLANKER_FEE_LOCKER, CLANKER_LP_LOCKER, clankerFeesOn, clankerTokenConfig } from "../../lib/launch/base/clanker";
import { clankerDeployTx } from "../../lib/launch/base/deploy";

const WALLET = "0x00000000000000000000000000000000000a9e17";

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

test("clanker: the owner's wallet is admin and sole reward recipient, paid in WETH, 1% static fee, no dev buy", async () => {
  const a = { owner: WALLET, name: "Njord", symbol: "NJORD", image: "ipfs://x", description: "sea", website: "https://mimir.test", slug: "njord" };
  const cfg = clankerTokenConfig(a);
  assert.equal(cfg.tokenAdmin, WALLET);
  assert.deepEqual(cfg.rewards.recipients, [{ admin: WALLET, recipient: WALLET, bps: 10_000, token: "Paired" }]);
  assert.deepEqual(cfg.fees, { type: "static", clankerFee: 100, pairedFee: 100 });
  assert.ok(!("devBuy" in cfg) && !("vault" in cfg));

  const tx = await clankerDeployTx(a);
  assert.equal(tx.to, CLANKER_FACTORY);
  assert.equal(tx.value, 0n);
  assert.match(tx.expectedAddress ?? "", /^0x[0-9a-fA-F]{40}$/);
  // The calldata the owner's wallet sends is exactly the SDK's deploy call.
  const sdk = await new Clanker().getDeployTransaction(cfg);
  const { args } = decodeFunctionData({ abi: sdk.abi as Abi, data: tx.data });
  const [d] = args as unknown as [{ tokenConfig: { tokenAdmin: string; symbol: string }; lockerConfig: { rewardRecipients: string[]; rewardBps: number[]; lockerData: `0x${string}` }; poolConfig: { pairedToken: string }; extensionConfigs: unknown[] }];
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
