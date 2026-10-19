import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import nacl from "tweetnacl";
import bs58 from "bs58";

import { create, launch, CreateBody, LAUNCH_FEE_LAMPORTS } from "../../lib/launch/flow";
import { openKey } from "../../lib/launch/byok";
import { isFreshLaunchSig, launchMessage } from "../../lib/launch/auth";
import { verifyAgentSignature } from "../../lib/agents/signature";

process.env.LAUNCH_BYOK_SECRET = "x".repeat(40);
const OWNER = "4aZvr5rReMZVp3NkAa31SaoXRRHGgVChbpaF5MyWTiy7";
const SIG = "5".repeat(88);

/** A Convex client that answers the launch functions from one in-memory agent. */
function fakeCx() {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let agent: Record<string, any> | null = null;
  const handlers: Record<string, (a: any) => unknown> = {
    "launch:createPending": (a) => {
      agent = { ...a, status: "pending", launch: { fundLamports: a.fundLamports, description: a.description, image: a.image } };
      return { ok: true, slug: a.slug };
    },
    "launch:forLaunch": () => agent && { owner: agent.owner, venue: agent.venue ?? "solana", name: agent.name, ticker: agent.ticker, avatarSeed: agent.avatarSeed, status: agent.status, mint: agent.mint ?? null, solana: agent.solana ?? null, robinhood: agent.robinhood ?? null, launch: agent.launch },
    "launch:claimLaunch": () => (agent!.launch.claimedAt ? false : ((agent!.launch.claimedAt = 1), true)),
    "launch:releaseLaunch": () => void (agent!.launch.claimedAt = undefined),
    "launch:recordLaunch": (a) => void Object.assign(agent!, { mint: a.mint, status: "live" }),
    "launch:logEvent": () => null,
  };
  const run = async (f: any, a: any) => {
    const name = getFunctionName(f);
    calls.push([name, a]);
    return handlers[name](a);
  };
  return { cx: { client: { mutation: run, query: run } as any, secret: "s".repeat(20) }, calls, agent: () => agent };
}

const body = (over: Record<string, unknown> = {}) => CreateBody.parse({
  name: "Njord", ticker: "NJORD", thesis: "Back the favourite.", seedSol: 0.5,
  brain: { kind: "mimir" }, trading: { enabled: false }, markets: { enabled: true }, ...over,
});
const wallets = { solana: async () => ({ id: "w1", address: "SoLwallet111" }), arc: async () => ({ id: "c1", address: "0xabc" }) };

test("create: stores a pending agent with both wallets and asks for seed + launch fee", async () => {
  const f = fakeCx();
  const r = await create(f.cx, { wallets, checkKey: async () => "ok" as const }, OWNER, body());
  assert.ok(r.ok);
  assert.equal(r.fundLamports, 500_000_000n + LAUNCH_FEE_LAMPORTS);
  const a = f.agent()!;
  assert.deepEqual([a.solana.address, a.arc.address, a.brain.kind, a.markets.enabled, a.trading.enabled], ["SoLwallet111", "0xabc", "mimir", true, false]);
  assert.equal(a.markets.rules.minEdge, 0.08);
});

test("create: a BYOK key is checked, then sealed to the agent's uid; a dead key makes no wallets", async () => {
  let made = 0;
  const w = { solana: async () => (made++, { id: "w", address: "a" }), arc: wallets.arc };
  const byok = { brain: { kind: "byok", provider: "openai", apiKey: "sk-test-1234567890abcdef" } };
  const bad = await create(fakeCx().cx, { wallets: w, checkKey: async () => "bad-key" as const }, OWNER, body(byok));
  assert.equal(bad.ok, false);
  assert.equal(made, 0);
  const f = fakeCx();
  assert.ok((await create(f.cx, { wallets: w, checkKey: async () => "ok" as const }, OWNER, body(byok))).ok);
  const a = f.agent()!;
  assert.equal(a.brain.last4, "cdef");
  assert.ok(!JSON.stringify(a).includes("sk-test"));
  assert.equal(openKey(a.uid, a.brain), "sk-test-1234567890abcdef");
});

test("body: nothing turned on is refused", () => {
  assert.equal(CreateBody.safeParse({ ...body(), markets: { enabled: false } }).success, false);
});

test("launch: verifies funding, mints once, idempotent after", async () => {
  const f = fakeCx();
  await create(f.cx, { wallets, checkKey: async () => "ok" as const }, OWNER, body());
  let mints = 0;
  const deps = {
    verify: async (_c: unknown, a: { minLamports: bigint }) => (assert.equal(a.minLamports, 510_000_000n), { ok: true as const, lamports: a.minLamports }),
    conn: {} as any,
    launchToken: async () => (mints++, { mint: "MiNt", sig: "sig", metadataUri: "ipfs://x" }),
    image: async () => "data:image/png;base64,AA==",
  };
  assert.equal((await launch(f.cx, deps, "someoneElse", "njord", SIG)).ok, false);
  const r = await launch(f.cx, deps, OWNER, "njord", SIG);
  assert.deepEqual([r.ok, r.ok && r.mint], [true, "MiNt"]);
  assert.ok((await launch(f.cx, deps, OWNER, "njord", SIG)).ok);
  assert.equal(mints, 1);
});

test("launch: a failure that did not send releases the claim so the owner can retry", async () => {
  const f = fakeCx();
  await create(f.cx, { wallets, checkKey: async () => "ok" as const }, OWNER, body());
  const deps = { verify: async () => ({ ok: true as const, lamports: 1n }), conn: {} as any, image: async () => "x", launchToken: async () => { throw new Error("rpc down"); } };
  assert.equal((await launch(f.cx, deps, OWNER, "njord", SIG)).ok, false);
  assert.equal(f.agent()!.launch.claimedAt, undefined);
  const amb = { ...deps, launchToken: async () => { throw Object.assign(new Error("?"), { name: "AmbiguousSendError" }); } };
  assert.equal((await launch(f.cx, amb, OWNER, "njord", SIG)).ok, false);
  assert.equal(f.agent()!.launch.claimedAt, 1);
});

test("auth: the signed message binds action, agent and body; stale signatures are refused", () => {
  const kp = nacl.sign.keyPair();
  const owner = bs58.encode(kp.publicKey);
  const m = { action: "launch" as const, owner, agent: "njord", bodySha256: "ab", signedAt: Date.now() };
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(launchMessage(m)), kp.secretKey));
  assert.ok(verifyAgentSignature({ address: owner, message: launchMessage(m), signature }));
  assert.ok(!verifyAgentSignature({ address: owner, message: launchMessage({ ...m, agent: "odin" }), signature }));
  assert.ok(!verifyAgentSignature({ address: owner, message: launchMessage({ ...m, action: "status" }), signature }));
  assert.ok(!isFreshLaunchSig(Date.now() - 6 * 60_000));
});

const PAYOUT = "0x00000000000000000000000000000000000beef1";
const rhWallets = { ...wallets, robinhood: async () => ({ id: "rh1", address: "0x00000000000000000000000000000000000a9e17" }) };

test("robinhood: needs the owner's Robinhood address, makes an EVM wallet and asks for seed + fee in wei", async () => {
  assert.equal(CreateBody.safeParse({ ...body(), chain: "robinhood" }).success, false);
  const f = fakeCx();
  const r = await create(f.cx, { wallets: rhWallets, checkKey: async () => "ok" as const }, OWNER, body({ chain: "robinhood", payout: PAYOUT }));
  assert.ok(r.ok);
  assert.equal(r.fundLamports, 500_000_000_000_000_000n + 1_000_000_000_000_000n);
  const a = f.agent()!;
  assert.equal(a.solana, undefined);
  assert.deepEqual(a.robinhood, { walletId: "rh1", address: "0x00000000000000000000000000000000000a9e17", payout: "0x00000000000000000000000000000000000bEEf1" });
});

test("robinhood: launch verifies ETH from the payout address and launches on Pons, not pump.fun", async () => {
  const f = fakeCx();
  await create(f.cx, { wallets: rhWallets, checkKey: async () => "ok" as const }, OWNER, body({ chain: "robinhood", payout: PAYOUT }));
  let pumped = 0;
  let seen: { from: string; to: string } | null = null;
  const deps = {
    verify: async () => ({ ok: true as const, lamports: 1n }), conn: {} as any, image: async () => "data:image/png;base64,AA==",
    launchToken: async () => (pumped++, { mint: "x", sig: "x", metadataUri: "x" }),
    robinhood: () => ({
      verify: async (_c: unknown, a: { from: string; to: string }) => ((seen = a), { ok: true as const, wei: 1n }),
      client: {} as any,
      launchToken: async () => ({ mint: "0x0000000000000000000000000000000000000Bee", sig: "0xhash", metadataUri: "ipfs://logo" }),
    }),
  };
  const r = await launch(f.cx, deps, OWNER, "njord", `0x${"a".repeat(64)}`);
  assert.deepEqual([r.ok, r.ok && r.mint, pumped], [true, "0x0000000000000000000000000000000000000Bee", 0]);
  assert.deepEqual(seen, { hash: `0x${"a".repeat(64)}`, from: "0x00000000000000000000000000000000000bEEf1", to: "0x00000000000000000000000000000000000a9e17", minWei: 501_000_000_000_000_000n });
});
