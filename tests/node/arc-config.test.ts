import assert from "node:assert/strict";
import test from "node:test";

import { arcConfig } from "../../lib/arc/config";

test("config: testnet by default, mainnet refuses to guess the RPC", () => {
  const t = arcConfig({});
  assert.equal(t.network, "testnet");
  assert.equal(t.chain.id, 5042002);
  assert.equal(t.usdc, "0x3600000000000000000000000000000000000000");
  assert.throws(() => arcConfig({ network: "mainnet" }), /NEXT_PUBLIC_ARC_RPC/);
  const m = arcConfig({ network: "mainnet", rpcUrl: "https://rpc.example" });
  assert.equal(m.chain.id, 5042);
});

test("config: a comma list of RPCs keeps its order, the first is the primary", () => {
  const c = arcConfig({ rpcUrl: " https://a.example , https://b.example,," });
  assert.deepEqual(c.chain.rpcUrls, ["https://a.example", "https://b.example"]);
  assert.equal(c.chain.rpcUrl, "https://a.example");
  assert.deepEqual(arcConfig({}).chain.rpcUrls, ["https://rpc.testnet.arc.network"]);
  assert.throws(() => arcConfig({ network: "mainnet", rpcUrl: " , " }), /NEXT_PUBLIC_ARC_RPC/);
});
