// The app's records on the backend store (lib/server/store.ts), run against the in-memory store with the same
// transaction rules: the checks each table relied on in Postgres still hold.
import test from "node:test";
import assert from "node:assert/strict";

import { memoryStore, StoreConflict, useMemoryStore } from "../../lib/server/store";

async function withStore<T>(fn: () => Promise<T>): Promise<T> {
  useMemoryStore();
  try {
    return await fn();
  } finally {
    useMemoryStore(null);
  }
}

test("a batch with a failing must-step writes nothing", async () => {
  const s = memoryStore();
  await s.tx([{ op: "insert", t: "x", k: "a", d: { v: 1 } }]);
  await assert.rejects(
    () => s.tx([{ op: "put", t: "x", k: "b", d: { v: 2 } }, { op: "insert", t: "x", k: "a", d: { v: 3 }, must: true }]),
    (e) => e instanceof StoreConflict && e.code === "exists",
  );
  assert.equal(await s.get("x", "b"), null);
  assert.deepEqual(await s.get("x", "a"), { v: 1 });
});

test("the wallet relay: first answer wins, one read takes it, expired answers are never returned", () =>
  withStore(async () => {
    const { putRelay, takeRelay, TTL_MS } = await import("../../lib/server/wallet-relay");
    const op = "A".repeat(22);
    assert.equal(await putRelay(op, { nonce: "n1", data: "d1" }, 1_000), true);
    assert.equal(await putRelay(op, { nonce: "n2", data: "d2" }, 1_001), false);
    assert.deepEqual(await takeRelay(op, 2_000), { nonce: "n1", data: "d1" });
    assert.equal(await takeRelay(op, 2_001), null);
    const late = "B".repeat(22);
    await putRelay(late, { data: "x" }, 1_000);
    assert.equal(await takeRelay(late, 1_000 + TTL_MS + 1), null);
  }));

test("invite redeem: a code is spent once, never by its owner, and grants the wallet", () =>
  withStore(async () => {
    const { store } = await import("../../lib/server/store");
    const { redeemInvite } = await import("../../lib/server/access");
    await store().tx([{ op: "insert", t: "access_invites", k: "MIMIR-AAAA-BBBB", d: { code: "MIMIR-AAAA-BBBB", owner: "O", created_at: 1, used_by: null, used_at: null }, i1: "O" }]);
    assert.equal(await redeemInvite("O", "MIMIR-AAAA-BBBB"), "own");
    const results = await Promise.all(["U1", "U2", "U3"].map((w) => redeemInvite(w, "MIMIR-AAAA-BBBB")));
    assert.deepEqual(results.filter((r) => r === "ok").length, 1);
    const winner = ["U1", "U2", "U3"][results.indexOf("ok")];
    assert.equal(((await store().get("access_grants", winner)) as { via: string }).via, "invite");
    assert.equal(await redeemInvite(winner, "MIMIR-AAAA-BBBB"), "already");
    assert.equal(await redeemInvite("U9", "MIMIR-ZZZZ-ZZZZ"), "invalid");
  }));

test("an Arc account binds to one Solana wallet; a wallet moving frees its old account", () =>
  withStore(async () => {
    const { upsertArcBinding, getArcBindingByArc, ArcAccountTakenError } = await import("../../lib/server/arc-accounts");
    await upsertArcBinding({ solana: "S1", arc: "0xA", credentialId: null, now: 1 });
    await assert.rejects(() => upsertArcBinding({ solana: "S2", arc: "0xA", credentialId: null }), ArcAccountTakenError);
    await upsertArcBinding({ solana: "S1", arc: "0xA", credentialId: "c", now: 2 });
    await upsertArcBinding({ solana: "S1", arc: "0xB", credentialId: null, now: 3 });
    assert.equal(await getArcBindingByArc("0xA"), null);
    assert.equal((await getArcBindingByArc("0xB"))?.solana, "S1");
    await upsertArcBinding({ solana: "S2", arc: "0xA", credentialId: null, now: 4 });
    assert.equal((await getArcBindingByArc("0xA"))?.solana, "S2");
  }));

test("rate limits count across calls in one window and reset in the next", () =>
  withStore(async () => {
    const { allowRequest } = await import("../../lib/server/rate-limit");
    const hits = await Promise.all(Array.from({ length: 5 }, () => allowRequest("t", "ip", 3, 60_000, 120_000)));
    assert.equal(hits.filter(Boolean).length, 3);
    assert.equal(await allowRequest("t", "ip", 3, 60_000, 180_001), true);
  }));

test("agent nonces and stored replies: a nonce is used once, a reply is found only for its own action", () =>
  withStore(async () => {
    const { consumeNonce, getStoredResponse, storeResponse } = await import("../../lib/agents/store");
    assert.equal(await consumeNonce("bot", "n"), true);
    assert.equal(await consumeNonce("bot", "n"), false);
    assert.equal(await consumeNonce("other", "n"), true);
    await storeResponse("bot", "idem", "challenge", 200, { ok: 1 });
    assert.deepEqual(await getStoredResponse("bot", "idem", "challenge"), { status: 200, body: { ok: 1 } });
    assert.equal(await getStoredResponse("bot", "idem", "dispute"), null);
  }));

test("agents: create once, keys revoke by prefix, the operator lookup follows a change", () =>
  withStore(async () => {
    const a = await import("../../lib/agents/store");
    await a.createAgent({ agentId: "bot", ownerWallet: "O", operatorWallet: "OP", payoutWallet: "O", displayName: "B", authorityLevel: 3 as never, capabilities: [] });
    await assert.rejects(() => a.createAgent({ agentId: "bot", ownerWallet: "X", operatorWallet: "X", payoutWallet: "X", displayName: "", authorityLevel: 3 as never, capabilities: [] }));
    await a.insertApiKey({ keyHash: "h1", agentId: "bot", keyPrefix: "mk_1", label: "", createdAt: 1 });
    await a.insertApiKey({ keyHash: "h2", agentId: "bot", keyPrefix: "mk_2", label: "", createdAt: 2 });
    assert.equal(await a.agentIdForKeyHash("h1"), "bot");
    assert.equal(await a.revokeApiKey("bot", "mk_1"), 1);
    assert.equal(await a.agentIdForKeyHash("h1"), null);
    assert.equal(await a.agentIdForKeyHash("h2"), "bot");
    await a.setArcOperator("bot", "0xAbC");
    assert.equal((await a.agentByArcOperator("0xabc"))?.agentId, "bot");
    await a.setAgentStatus("bot", "revoked");
    assert.equal((await a.listAgents()).length, 0);
  }));

test("a deploy payment pays for one agent only", () =>
  withStore(async () => {
    const { recordDeployPayment } = await import("../../lib/server/agent-payment");
    await recordDeployPayment("0xabc", "a1", "O", 1n);
    await assert.rejects(() => recordDeployPayment("0xabc", "a2", "O", 1n), /already paid/);
  }));

test("baskets: an id is taken once; a follow only lands with a newer signature", () =>
  withStore(async () => {
    const b = await import("../../lib/baskets-store");
    const members = [
      { agentId: "optimist", weightBps: 5000 },
      { agentId: "doomer", weightBps: 5000 },
    ];
    const input = { id: "two", name: "Two", thesis: "Two sides of every claim", creatorWallet: "C", members, signature: "s" };
    await b.createBasket(input, 1);
    await assert.rejects(() => b.createBasket(input, 2), b.BasketExistsError);
    assert.equal(await b.setSubscription({ basketId: "two", follower: "F", perMarketCapUsdc: 5, signature: "a", signedAt: 10 }), true);
    assert.equal(await b.setSubscription({ basketId: "two", follower: "F", perMarketCapUsdc: 9, signature: "b", signedAt: 9 }), false);
    assert.equal((await b.getBasket("two"))?.followers, 1);
    assert.equal(await b.setSubscription({ basketId: "two", follower: "F", perMarketCapUsdc: 0, signature: "c", signedAt: 11 }), true);
    assert.equal((await b.getBasket("two"))?.followers, 0);
  }));

test("copy permissions: an old grant cannot overwrite newer terms or revive a revoked one", () =>
  withStore(async () => {
    const c = await import("../../lib/copy-trading-store");
    const base = {
      id: "p", follower: "F", signalAgentId: "s", executionAgentId: "e", active: true, expiresAt: 10_000_000_000_000,
      maxPerPositionUsdc: 1, maxDailyUsdc: 1, maxWeeklyUsdc: 1, maxOpenExposureUsdc: 1, maxRealizedLossUsdc: 1,
      allowedCategories: [], minClaimQuality: 0, minPayoutRatio: 1, signature: "x", createdAt: 1,
    };
    assert.equal(await c.savePermission({ ...base, signedAt: 10 }), true);
    assert.equal(await c.savePermission({ ...base, signedAt: 5, maxDailyUsdc: 99 }), false);
    assert.equal(await c.revokePermission("p", "F", 20), 1);
    assert.equal(await c.savePermission({ ...base, signedAt: 15 }), false, "signed before the revocation");
    assert.equal(await c.savePermission({ ...base, signedAt: 25 }), true);
    assert.equal((await c.permissionsForExecutor("e")).length, 1);
    assert.equal(await c.revokePermission("p", "someone else", 30), 0);
  }));
