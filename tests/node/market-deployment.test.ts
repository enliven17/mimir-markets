import assert from "node:assert/strict";
import test from "node:test";
import { assertSameDeployment, marketDeployment } from "../../lib/chains/deployment";
import { marketChains } from "../../lib/chains/registry";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const config = { mimirV3: address(1), mimirPool: address(2), mimirFees: address(3), fromBlock: "123" };
const sepolia = marketDeployment(marketChains({ arc: {}, base: config }).chains.base);

test("deployment binding refuses unbound reads and writes", () => {
  assert.throws(() => assertSameDeployment(null, sepolia), /not bound/);
});

test("Sepolia and mainnet cannot share a market index, even at identical addresses", () => {
  const mainnet = marketDeployment(marketChains({ arc: {}, base: { ...config, network: "mainnet" } }).chains.base);
  assert.throws(() => assertSameDeployment(sepolia, mainnet), /deployment mismatch/);
  assert.throws(() => assertSameDeployment(mainnet, sepolia), /deployment mismatch/);
});

test("changing contracts, token or deployment block cannot silently reuse market IDs/cursors", () => {
  for (const field of ["v3", "pool", "fees", "usdc", "fromBlock", "chainId", "network"] as const) {
    const next = { ...sepolia, [field]: field === "chainId" ? 8453 : "changed" };
    assert.throws(() => assertSameDeployment(sepolia, next), /deployment mismatch/);
  }
  assert.doesNotThrow(() => assertSameDeployment({ ...sepolia }, sepolia));
});

test("an incomplete contract set cannot be bound", () => {
  const chain = marketChains({ arc: {}, base: { ...config, mimirFees: undefined } }).chains.base;
  assert.throws(() => marketDeployment(chain), /all three/);
});
