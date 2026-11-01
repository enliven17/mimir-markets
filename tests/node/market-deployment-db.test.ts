import assert from "node:assert/strict";
import test from "node:test";
import { bind } from "../../convex/marketDeployment";
import { assertMarketDeployment } from "../../convex/marketDeploymentGuard";
import type { DatabaseWriter } from "../../convex/_generated/server";

type Row = Record<string, unknown>;
class Store {
  tables = new Map<string, Row[]>();
  query(table: string) {
    let rows = [...(this.tables.get(table) ?? [])];
    const query = {
      withIndex: (_name: string, select: (q: unknown) => unknown) => {
        const q = { eq: (field: string, value: unknown) => { rows = rows.filter((r) => r[field] === value); return q; } };
        select(q); return query;
      },
      first: async () => rows[0] ?? null,
      unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
    };
    return query;
  }
  async insert(table: string, row: Row) { this.tables.set(table, [...(this.tables.get(table) ?? []), row]); return "id"; }
  context() { return { db: this as unknown as DatabaseWriter }; }
}
const callBind = (bind as unknown as { _handler: (ctx: ReturnType<Store["context"]>, args: { chain: "base"; adoptExistingTestnet?: boolean }) => Promise<unknown> })._handler;

async function configured(network: string, run: () => Promise<void>) {
  const values = { MARKET_CHAINS: "base", BASE_NETWORK: network, MIMIR_BASE_V3_ADDRESS: "0x1111111111111111111111111111111111111111", MIMIR_BASE_POOL_ADDRESS: "0x2222222222222222222222222222222222222222", MIMIR_BASE_FEES_ADDRESS: "0x3333333333333333333333333333333333333333", MIMIR_BASE_FROM_BLOCK: "123" };
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  try { await run(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("database guard requires a binding, permits the bound environment, and rejects repointing it", async () => {
  const store = new Store();
  await configured("testnet", async () => {
    await assert.rejects(assertMarketDeployment(store.context()), /not bound/);
    await callBind(store.context(), { chain: "base" });
    await assertMarketDeployment(store.context());
    await callBind(store.context(), { chain: "base" }); // idempotent
  });
  await configured("mainnet", async () => {
    await assert.rejects(assertMarketDeployment(store.context()), /deployment mismatch/);
    await assert.rejects(callBind(store.context(), { chain: "base" }), /deployment mismatch/);
  });
});

test("legacy testnet records need explicit adoption; mainnet never adopts them", async () => {
  const store = new Store();
  store.tables.set("arcMarkets", [{ chain: "base", marketId: 1 }]);
  await configured("mainnet", async () => {
    await assert.rejects(callBind(store.context(), { chain: "base", adoptExistingTestnet: true }), /clean Convex/);
  });
  await configured("testnet", async () => {
    await assert.rejects(callBind(store.context(), { chain: "base" }), /explicit/);
    await callBind(store.context(), { chain: "base", adoptExistingTestnet: true });
    await assertMarketDeployment(store.context());
    assert.equal(store.tables.get("arcMarkets")?.length, 1); // preserved, not wiped
  });
});

test("a leftover cursor or agent wallet prevents binding a supposedly empty mainnet", async () => {
  await configured("mainnet", async () => {
    for (const [table, row] of [["arcCursor", { name: "base", block: 999 }], ["launchAgents", { id: "legacy-wallet" }], ["appStore", { t: "copy_permissions" }]] as const) {
      const store = new Store(); store.tables.set(table, [row]);
      await assert.rejects(callBind(store.context(), { chain: "base" }), /clean Convex/);
      assert.equal(store.tables.has("marketDeployments"), false);
    }
  });
});
