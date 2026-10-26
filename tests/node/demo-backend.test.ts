import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as demo from "../../convex/demo";
import { DEMO } from "../../lib/demo/types";
import bs58 from "bs58";

// A small indexed DB adapter exercises the actual Convex handlers. Transaction rollback mirrors Convex writes.
function backend() {
  let rows = new Map<string, any>();
  let next = 0;
  const touched = new Set<string>();
  const db = {
    async get(id: string) { return structuredClone(rows.get(id) ?? null); },
    async insert(table: string, value: any) { touched.add(table); const id = `${table}_${++next}`; rows.set(id, { ...structuredClone(value), _id: id, _creationTime: next }); return id; },
    async patch(id: string, value: any) { const r = rows.get(id); assert.ok(r); rows.set(id, { ...r, ...structuredClone(value) }); },
    async delete(id: string) { rows.delete(id); },
    normalizeId(table: string, id: string) { return id.startsWith(`${table}_`) ? id : null; },
    query(table: string) {
      touched.add(table);
      const predicates: Array<(r: any) => boolean> = [];
      let order = 1, sortField = "_creationTime";
      const q: any = {};
      for (const [op, check] of Object.entries({ eq: (a: any, b: any) => a === b, gt: (a: number, b: number) => a > b, lt: (a: number, b: number) => a < b, lte: (a: number, b: number) => a <= b })) {
        q[op] = (field: string, value: any) => { predicates.push((r) => check(r[field], value)); return q; };
      }
      const result = () => [...rows.values()].filter((r) => r._id.startsWith(`${table}_`) && predicates.every((p) => p(r))).sort((a, b) => order * (a[sortField] - b[sortField]));
      const chain: any = {
        withIndex(index: string, filter?: (q: any) => void) { if (index === "by_due") sortField = "nextTickAt"; if (index === "by_expires") sortField = "expiresAt"; filter?.(q); return chain; },
        order(value: string) { order = value === "desc" ? -1 : 1; return chain; },
        async unique() { const r = result(); assert.ok(r.length < 2); return structuredClone(r[0] ?? null); },
        async take(n: number) { return structuredClone(result().slice(0, n)); },
      };
      return chain;
    },
  };
  return {
    db, touched,
    async run(fn: unknown, args: unknown) {
      const snapshot = structuredClone(rows);
      try { return await (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler({ db }, args); }
      catch (e) { rows = snapshot; throw e; }
    },
  };
}
const secret = "test-demo-secret-123456789";
const credentials = (hash = "a".repeat(64)) => ({ secret, hash, owner: bs58.encode(Buffer.from(hash, "hex")) });
const input = { name: "Demo", ticker: "DEMO", chain: "arc", trading: { enabled: false }, markets: { enabled: true } };
let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { ...process.env }; process.env.DEMO_ENABLED = "1"; process.env.MIMIR_LAUNCH_SECRET = secret; delete process.env.MIMIR_BACKEND_OFF; });
afterEach(() => { process.env = env; });

test("paired trials create fresh versions atomically, enforce ownership and preserve the base record", async () => {
  const b = backend(), c = credentials(); await b.run(demo.createSession, c);
  const base = await b.run(demo.createAgent, { ...c, input });
  const baseModel = (await b.db.get(base.id)).strategy.model;
  process.env.DEMO_GEMINI_MODEL = "different-default";
  const other = credentials("b".repeat(64)); await b.run(demo.createSession, other);
  assert.match((await b.run(demo.createTrial, { ...other, source: base.id, metric: "minEdge", a: 10, b: 20 })).error, /your session/);
  const trial = await b.run(demo.createTrial, { ...c, source: base.id, metric: "minEdge", a: 10, b: 20 });
  assert.equal(trial.ids.length, 2);
  const [a, childB] = await Promise.all(trial.ids.map((id: string) => b.db.get(id)));
  assert.equal(a.markets.rules.minEdge, .1); assert.equal(childB.markets.rules.minEdge, .2);
  assert.equal(a.strategy.parent, base.id); assert.notEqual(a.strategy.fingerprint, childB.strategy.fingerprint);
  assert.equal(a.strategy.model, baseModel); assert.equal(childB.strategy.model, baseModel);
  assert.equal(a.state.pnl, 0); assert.equal(a.state.trades.length, 0);
  assert.equal((await b.db.get(base.id)).strategy.revision, 1);
  assert.match((await b.run(demo.createTrial, { ...c, source: base.id, metric: "minEdge", a: 10, b: 20 })).error, /two free/);
});

test("wallet reauthentication preserves its quota even after cookies are cleared or credentials rotate", async () => {
  const b = backend();
  const original = credentials();
  await b.run(demo.createSession, original);
  for (let i = 0; i < 3; i++) await b.run(demo.createAgent, { ...original, input });
  const rotated = { ...original, hash: "c".repeat(64) };
  await b.run(demo.createSession, rotated);
  assert.equal((await b.db.query("demoSessions").take(10)).length, 1);
  assert.equal((await b.run(demo.dashboard, rotated)).agents.length, 3);
  assert.match((await b.run(demo.createAgent, { ...rotated, input })).error, /3 agents/);
});

test("a renewed wallet session does not revive expired agents or duplicate its credential hash", async () => {
  const b = backend(); const c = credentials();
  await b.run(demo.createSession, c);
  await b.run(demo.createAgent, { ...c, input });
  const old = await b.db.query("demoSessions").withIndex("by_hash", (q: any) => q.eq("hash", c.hash)).unique();
  await b.db.patch(old._id, { expiresAt: Date.now() - 1 });
  await b.run(demo.createSession, c);
  assert.deepEqual((await b.run(demo.dashboard, c)).agents, []);
  assert.equal((await b.db.query("demoSessions").withIndex("by_owner", (q: any) => q.eq("owner", c.owner)).unique()).agentsCreated, 0);
});

test("demo writes require the server secret and an unexpired guest session", async () => {
  const b = backend();
  await assert.rejects(b.run(demo.createSession, { ...credentials(), secret: "wrong" }), /unavailable/);
  await assert.rejects(b.run(demo.createAgent, { ...credentials(), input }), /demo_session_expired/);
  await b.run(demo.createSession, credentials());
  const s = await b.db.query("demoSessions").withIndex("by_hash", (q: any) => q.eq("hash", credentials().hash)).unique();
  await b.db.patch(s._id, { expiresAt: Date.now() - 1 });
  await assert.rejects(b.run(demo.createAgent, { ...credentials(), input }), /demo_session_expired/);
});

test("a session can create only three paper agents and never touches live tables or wallet services", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  for (let i = 0; i < 3; i++) assert.ok((await b.run(demo.createAgent, { ...credentials(), input })).id);
  assert.match((await b.run(demo.createAgent, { ...credentials(), input })).error, /3 agents/);
  const result = await b.run(demo.dashboard, credentials());
  assert.equal(result.agents.length, 3);
  const serialized = JSON.stringify(result);
  for (const key of ["wallet", "walletId", "session", "hash", "secret", "mint", "sealed"]) assert.equal(serialized.includes(`"${key}"`), false, key);
  assert.deepEqual([...b.touched].filter((t) => !t.startsWith("demo")), []);
});

test("directory responses omit price history; only the requested owned agent includes it", async () => {
  const b = backend(); const c = credentials(); await b.run(demo.createSession, c);
  const a = await b.run(demo.createAgent, { ...c, input });
  const row = await b.db.get(a.id);
  await b.db.patch(a.id, { state: { ...row.state, priceHistory: [{ mint: "token", symbol: "T", points: [{ at: 1, price: 1 }] }] } });
  assert.equal((await b.run(demo.dashboard, c)).agents[0].state.priceHistory, undefined);
  assert.equal((await b.run(demo.dashboard, { ...c, detail: a.id })).agents[0].state.priceHistory.length, 1);
  assert.equal((await b.run(demo.dashboard, { ...c, detail: "another-agent" })).agents[0].state.priceHistory, undefined);
});

test("public directory includes every wallet and house agents without credentials or chart histories", async () => {
  const b = backend(); await b.run(demo.ensureShowcase, {});
  const ids: string[] = [];
  for (const c of [credentials(), credentials("b".repeat(64))]) {
    await b.run(demo.createSession, c);
    ids.push((await b.run(demo.createAgent, { ...c, input })).id);
  }
  const a = await b.db.get(ids[0]);
  await b.db.patch(a._id, { state: { ...a.state, priceHistory: [{ mint: "token", symbol: "T", points: [{ at: 1, price: 1 }] }] } });
  await b.db.insert("demoStakes", { agentId: a._id, status: "open", amount: 5 });
  await b.db.insert("demoStakes", { agentId: a._id, status: "won", amount: 5 });
  const directory = await b.run(demo.directory, {});
  assert.equal(directory.agents.length, 7);
  for (const id of ids) assert.ok(directory.agents.some((a: any) => a.id === id));
  assert.equal(directory.stakes.length, 1);
  assert.ok(directory.agents.every((a: any) => a.state.priceHistory === undefined));
  const detail = await b.run(demo.directory, { agent: a._id });
  assert.deepEqual(detail.agents.map((a: any) => a.id), [a._id]);
  assert.equal(detail.agents[0].state.priceHistory.length, 1);
  assert.equal(detail.stakes.length, 2);
  for (const value of [directory, detail]) {
    const serialized = JSON.stringify(value);
    for (const key of ["session", "owner", "hash", "secret", "walletId", "baskets"]) assert.equal(serialized.includes(`"${key}"`), false, key);
  }
  // Public viewing does not confer ownership.
  assert.ok((await b.run(demo.setStatus, { ...credentials("b".repeat(64)), id: a._id, status: "paused" })).error);
  await b.db.patch(a._id, { expiresAt: Date.now() - 1 });
  assert.equal((await b.run(demo.directory, {})).agents.length, 6);
  assert.equal((await b.run(demo.directory, { agent: a._id })).agents.length, 0);
  assert.equal((await b.run(demo.directory, { agent: "invalid" })).agents.length, 0);
  process.env.DEMO_ENABLED = "0";
  assert.deepEqual(await b.run(demo.directory, {}), { agents: [], stakes: [] });
});

test("global capacity blocks new guests even if they change sessions", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  for (let i = 0; i < DEMO.maxActiveAgents; i++) await b.db.insert("demoAgents", { expiresAt: Date.now() + 60_000 });
  assert.match((await b.run(demo.createAgent, { ...credentials(), input })).error, /capacity/);
});

test("guest A cannot pause or compose baskets with guest B's agents", async () => {
  const b = backend();
  await b.run(demo.createSession, credentials());
  await b.run(demo.createSession, credentials("b".repeat(64)));
  const a = await b.run(demo.createAgent, { ...credentials(), input });
  const other = credentials("b".repeat(64));
  assert.ok((await b.run(demo.setStatus, { ...other, id: a.id, status: "paused" })).error);
  assert.ok((await b.run(demo.createBasket, { ...other, input: { name: "Steal", members: [{ agentId: a.id, weightBps: 10_000 }] } })).error);
  assert.equal((await b.db.get(a.id)).status, "live");
});

test("a pause during a worker tick invalidates its paper fills and cannot be overwritten", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  const a = await b.run(demo.createAgent, { ...credentials(), input });
  const [claim] = await b.run(demo.claimTick, {});
  assert.equal((await b.run(demo.claimTick, {})).length, 0);
  await b.run(demo.setStatus, { ...credentials(), id: a.id, status: "paused" });
  await b.run(demo.finishTick, { id: a.id, version: claim.version, state: { ...claim.agent.state, cash: 0 }, pause: false, stake: { bad: true } });
  const saved = await b.db.get(a.id);
  assert.equal(saved.status, "paused");
  assert.equal(saved.state.cash, DEMO.initialNative);
  assert.equal((await b.db.query("demoStakes").take(10)).length, 0);
  assert.equal(await b.run(demo.claimAi, { id: a.id, version: claim.version }), false);
});

test("tick commit is idempotent and shutdown is terminal", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  const a = await b.run(demo.createAgent, { ...credentials(), input });
  const [claim] = await b.run(demo.claimTick, {});
  const args = { id: a.id, version: claim.version, state: { ...claim.agent.state, usdc: 998 }, pause: false, stake: { agentId: a.id, status: "open", amount: 2 } };
  await b.run(demo.finishTick, args); await b.run(demo.finishTick, args);
  assert.equal((await b.db.query("demoStakes").take(10)).length, 1);
  await b.run(demo.setStatus, { ...credentials(), id: a.id, status: "killed" });
  assert.ok((await b.run(demo.setStatus, { ...credentials(), id: a.id, status: "live" })).error);
});

test("AI credits enforce per-agent, global hourly and global daily ceilings before any call", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await b.run(demo.createAgent, { ...credentials(), input })).id);
  for (let i = 0; i < DEMO.agentAiCallsPerDay; i++) assert.equal(await b.run(demo.claimAi, { id: ids[0], version: 0 }), true);
  assert.equal(await b.run(demo.claimAi, { id: ids[0], version: 0 }), false);
  for (let i = DEMO.agentAiCallsPerDay; i < DEMO.aiCallsPerHour; i++) assert.equal(await b.run(demo.claimAi, { id: ids[1], version: 0 }), true);
  assert.equal(await b.run(demo.claimAi, { id: ids[2], version: 0 }), false);
  const hour = await b.db.query("demoControl").withIndex("by_key", (q: any) => q.eq("key", "ai-hour")).unique();
  const day = await b.db.query("demoControl").withIndex("by_key", (q: any) => q.eq("key", "ai-day")).unique();
  await b.db.patch(hour._id, { value: { window: -1, hits: 0 } });
  await b.db.patch(day._id, { value: { window: Math.floor(Date.now() / 86_400_000), hits: DEMO.aiCallsPerDay } });
  assert.equal(await b.run(demo.claimAi, { id: ids[2], version: 0 }), false);
});

test("shared feed lease prevents refresh stampedes and ignores a stale worker's save", async () => {
  const b = backend();
  const first = await b.run(demo.feed, {});
  assert.equal(first.refresh, true);
  assert.equal((await b.run(demo.feed, {})).refresh, false);
  const snapshot = { at: Date.now(), solana: [], robinhood: [], markets: [] };
  await b.run(demo.saveFeed, { token: first.token + 1, snapshot });
  assert.equal((await b.run(demo.feed, {})).snapshot, null);
  await b.run(demo.saveFeed, { token: first.token, snapshot });
  assert.deepEqual((await b.run(demo.feed, {})).snapshot, snapshot);
  assert.equal((await b.run(demo.feed, {})).refresh, false);
});

test("basket baseline starts at composition, not at the member's earlier profits", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  const a = await b.run(demo.createAgent, { ...credentials(), input });
  const saved = await b.db.get(a.id);
  await b.db.patch(a.id, { state: { ...saved.state, usdc: 1_100 } });
  const basket = { name: "Paper mix", members: [{ agentId: a.id, weightBps: 10_000 }] };
  for (let i = 0; i < 3; i++) assert.ok((await b.run(demo.createBasket, { ...credentials(), input: basket })).id);
  assert.ok((await b.run(demo.createBasket, { ...credentials(), input: basket })).error);
  let view = await b.run(demo.dashboard, credentials());
  assert.equal(view.baskets[0].nav, 1_000);
  await b.db.patch(a.id, { state: { ...saved.state, usdc: 1_210 } });
  view = await b.run(demo.dashboard, credentials());
  assert.ok(Math.abs(view.baskets[0].totalReturn - 0.1) < 1e-10);
});

test("expired sessions and all their demo records are pruned without touching live tables", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  const a = await b.run(demo.createAgent, { ...credentials(), input });
  await b.run(demo.createBasket, { ...credentials(), input: { name: "Paper", members: [{ agentId: a.id, weightBps: 10_000 }] } });
  const s = (await b.db.query("demoSessions").take(1))[0];
  await b.db.patch(s._id, { expiresAt: Date.now() - 2 * 86_400_000 });
  await b.run(demo.sweep, {});
  for (const table of ["demoSessions", "demoAgents", "demoBaskets"]) assert.equal((await b.db.query(table).take(10)).length, 0);
  assert.deepEqual([...b.touched].filter((t) => !t.startsWith("demo")), []);
});

test("five public house demos are seeded once across three chains without consuming guest allowances", async () => {
  const b = backend();
  await b.run(demo.ensureShowcase, {}); await b.run(demo.ensureShowcase, {});
  const view = await b.run(demo.showcase, {});
  assert.equal(view.agents.length, 5);
  assert.deepEqual([...new Set(view.agents.map((a: any) => a.chain))].sort(), ["arc", "robinhood", "solana"]);
  assert.equal(new Set(view.agents.map((a: any) => a.id)).size, 5);
  await b.run(demo.createSession, credentials());
  for (let i = 0; i < 3; i++) assert.ok((await b.run(demo.createAgent, { ...credentials(), input })).id);
  assert.equal((await b.run(demo.dashboard, credentials())).agents.length, 3);
  assert.equal((await b.db.query("demoAgents").take(100)).length, 8);
});

test("house demo AI cannot exhaust the full guest allowance", async () => {
  const b = backend(); await b.run(demo.ensureShowcase, {});
  const view = await b.run(demo.showcase, {});
  const house = view.agents[0];
  for (let i = 0; i < DEMO.showcaseAiCallsPerHour; i++) assert.equal(await b.run(demo.claimAi, { id: house.id, version: 0 }), true);
  assert.equal(await b.run(demo.claimAi, { id: view.agents[1].id, version: 0 }), false);
  await b.run(demo.createSession, credentials());
  const guest = await b.run(demo.createAgent, { ...credentials(), input });
  assert.equal(await b.run(demo.claimAi, { id: guest.id, version: 0 }), true);
});

test("public house demos expose no guest credentials and disabled demo seeds nothing", async () => {
  const b = backend();
  process.env.DEMO_ENABLED = "0"; await b.run(demo.ensureShowcase, {});
  assert.equal((await b.db.query("demoAgents").take(10)).length, 0);
  process.env.DEMO_ENABLED = "1"; await b.run(demo.ensureShowcase, {});
  const serialized = JSON.stringify(await b.run(demo.showcase, {}));
  for (const key of ["session", "hash", "secret", "walletId"]) assert.equal(serialized.includes(`"${key}"`), false);
});

test("a final market settles virtual funds exactly once even across repeated worker claims", async () => {
  const b = backend(); await b.run(demo.createSession, credentials());
  const a = await b.run(demo.createAgent, { ...credentials(), input });
  const saved = await b.db.get(a.id);
  await b.db.patch(a.id, { state: { ...saved.state, usdc: 995 } });
  const id = await b.db.insert("demoStakes", { agentId: a.id, marketId: 42, amount: 5, side: 1, status: "open" });
  await b.db.insert("arcMarkets", { kind: "pool", marketId: 42, status: "resolved", winner: 1, stakeA: String(100n * 10n ** 18n), stakeB: String(100n * 10n ** 18n) });
  await b.run(demo.claimTick, {});
  const once = await b.db.get(a.id);
  assert.ok(once.state.usdc > 1_000);
  assert.equal((await b.db.get(id)).status, "won");
  await b.db.patch(a.id, { nextTickAt: Date.now() - 1 });
  await b.run(demo.claimTick, {});
  const twice = await b.db.get(a.id);
  assert.equal(twice.state.usdc, once.state.usdc);
  assert.equal(twice.state.marketPnl, once.state.marketPnl);
});
