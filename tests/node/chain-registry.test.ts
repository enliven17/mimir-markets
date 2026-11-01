import assert from "node:assert/strict";
import test from "node:test";

import { indexToDecimal6, floorToChain, SubUnitAmountError, toChainUnits, toIndexUnits, unitScale, usdToIndex } from "../../lib/chains/amounts";
import { BASE_USDC, marketChains, parseEnabledChains, serverMarketChains } from "../../lib/chains/registry";
import { circleBlockchain, councilWallets, houseAddresses, houseCreatorWallet, oracleKeyFor } from "../../lib/chains/house";
import { marketPath, marketRef } from "../../lib/chains/links";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const KEY_A = `0x${"1".repeat(64)}`;
const KEY_B = `0x${"2".repeat(64)}`;

test("registry: without contracts no chain is enabled, nothing throws, Base is still the default", () => {
  const r = marketChains({ arc: {}, base: {} });
  assert.deepEqual(r.enabled, []);
  assert.equal(r.defaultChain, "base");
  assert.equal(r.chains.base.chainId, 84532);
  assert.equal(r.chains.base.usdc.address, BASE_USDC.testnet);
  assert.equal(r.chains.base.usdc.decimals, 6);
  assert.equal(r.chains.base.gas.symbol, "ETH");
  assert.equal(r.chains.arc.usdc.kind, "native");
  // Arc mainnet without an RPC disables Arc instead of crashing the build.
  const m = marketChains({ arc: { network: "mainnet", mimirV3: A(1), mimirPool: A(2) }, base: {} });
  assert.equal(m.chains.arc.enabled, false);
});

test("registry: a chain is enabled with both market contracts, Base first; the list and default switch it", () => {
  const env = { arc: { mimirV3: A(1), mimirPool: A(2) }, base: { mimirV3: A(3), mimirPool: A(4), network: "mainnet", minStake: "0.25" } };
  const r = marketChains(env);
  assert.deepEqual(r.enabled, ["base", "arc"]);
  assert.equal(r.defaultChain, "base");
  assert.equal(r.chains.base.chainId, 8453);
  assert.equal(r.chains.base.usdc.address, BASE_USDC.mainnet);
  assert.equal(r.chains.base.explorer, "https://basescan.org");
  assert.equal(r.chains.base.contracts.minStakeWei, 250_000_000_000_000_000n);
  assert.deepEqual(marketChains({ ...env, marketChains: "arc" }).enabled, ["arc"]);
  assert.equal(marketChains({ ...env, marketChains: "arc" }).defaultChain, "arc");
  assert.equal(marketChains({ ...env, defaultChain: "arc" }).defaultChain, "arc");
  // A base-only config whose only chain lacks contracts falls back to the first enabled one.
  assert.equal(marketChains({ arc: env.arc, base: {}, defaultChain: "base" }).defaultChain, "arc");
  // Only one contract: still off.
  assert.equal(marketChains({ arc: {}, base: { mimirV3: A(3) } }).chains.base.enabled, false);
});

test("registry: enabled-chain list parsing, and the backend reads its own env names", () => {
  assert.deepEqual(parseEnabledChains(undefined), ["base", "arc"]);
  assert.deepEqual(parseEnabledChains(" Arc , base,base, sol"), ["arc", "base"]);
  assert.deepEqual(parseEnabledChains(","), []);
  const r = serverMarketChains({ MIMIR_BASE_V3_ADDRESS: A(5), MIMIR_BASE_POOL_ADDRESS: A(6), BASE_RPC: "https://b.example, https://c.example", MIMIR_V3_ADDRESS: A(1) });
  assert.deepEqual(r.enabled, ["base"]);
  assert.deepEqual(r.chains.base.rpcUrls, ["https://b.example", "https://c.example"]);
  assert.equal(r.chains.arc.enabled, false);
});

test("amounts: Base scales by 1e12 both ways, exactly; dust is refused or floored on purpose", () => {
  const base = { usdc: { decimals: 6 as const } };
  const arc = { usdc: { decimals: 18 as const } };
  assert.equal(unitScale(base), 1_000_000_000_000n);
  assert.equal(unitScale(arc), 1n);
  assert.equal(toIndexUnits(base, 2_500_000n), 2_500_000_000_000_000_000n);
  assert.equal(toChainUnits(base, 2_500_000_000_000_000_000n), 2_500_000n);
  assert.equal(toChainUnits(arc, 123n), 123n);
  assert.throws(() => toChainUnits(base, 2_500_000_000_000_000_001n), SubUnitAmountError);
  assert.equal(floorToChain(base, 2_500_000_999_999_999_999n), 2_500_000_000_000_000_000n);
  assert.equal(usdToIndex(0.1), 100_000_000_000_000_000n);
  assert.equal(usdToIndex(-1), 0n);
  assert.equal(indexToDecimal6(2_500_000_000_000_000_000n), "2.5");
  assert.equal(indexToDecimal6(3_000_000_000_000_000_000n), "3");
});

test("house wallets, oracle key and Circle blockchains per chain", () => {
  const env = {
    ARC_CREATOR_WALLET: JSON.stringify({ id: "a", address: A(10).toUpperCase().replace("0X", "0x") }),
    BASE_CREATOR_WALLET: JSON.stringify({ id: "b", address: A(11) }),
    BASE_COUNCIL_WALLETS: JSON.stringify({ socrates: { id: "s", address: A(12) } }),
    ARC_ORACLE_KEY: KEY_A,
  };
  assert.equal(houseCreatorWallet("arc", env)?.address, A(10));
  assert.equal(houseCreatorWallet("base", env)?.id, "b");
  assert.deepEqual(Object.keys(councilWallets("base", env)), ["socrates"]);
  assert.deepEqual(councilWallets("arc", env), {});
  assert.deepEqual(houseAddresses(env).sort(), [A(10), A(11), A(12)].sort());
  // One oracle key on every chain: ARC_ORACLE_KEY is its deprecated alias, BASE_ORACLE_KEY is not read.
  assert.equal(oracleKeyFor("base", env), KEY_A);
  assert.equal(oracleKeyFor("base", { ...env, BASE_ORACLE_KEY: KEY_B }), KEY_A);
  assert.equal(oracleKeyFor("arc", { ARC_ORACLE_KEY: "nope" }), null);
  assert.equal(circleBlockchain("base", "testnet"), "BASE-SEPOLIA");
  assert.equal(circleBlockchain("base", "mainnet"), "BASE");
  assert.equal(circleBlockchain("arc", "testnet"), "ARC-TESTNET");
});

test("links: /arena/<chain>/<kind>/<id>, with Arc refs unchanged from before Base", () => {
  assert.equal(marketPath("base", "pool", 3), "/arena/base/pool/3");
  assert.equal(marketPath(undefined, "vs", 7), "/arena/arc/vs/7");
  assert.equal(marketRef("arc", "vs", 7), "vs-7");
  assert.equal(marketRef("base", "pool", 3), "base-pool-3");
});
