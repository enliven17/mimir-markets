import assert from "node:assert/strict";
import { test } from "node:test";
import { getFunctionName } from "convex/server";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { create, CreateBody } from "../../lib/launch/flow";
import { openKey } from "../../lib/launch/byok";
import { isFreshLaunchSig, launchMessage } from "../../lib/launch/auth";
import { verifyWalletSignature } from "../../lib/agents/signature";
import { ARGUS, ARGUS_ABI } from "../../lib/launch/argus";
import { CLANKER_EVENTS_ABI, CLANKER_FACTORY } from "../../lib/launch/base/clanker";
import { prepareTokenLaunch, recordTokenLaunch, TokenPrepareBody, verifyTokenLaunch, type ReceiptReader } from "../../lib/launch/token";

process.env.LAUNCH_BYOK_SECRET = "x".repeat(40);
const OWNER = "0x00000000000000000000000000000000000a11ce";
const STRANGER = "0x00000000000000000000000000000000000bad00";

/** A Convex client that answers the launch functions from one in-memory agent. */
function fakeCx() {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let agent: Record<string, any> | null = null;
  const handlers: Record<string, (a: any) => unknown> = {
    "launch:create": (a) => {
      const { secret: _s, ...rest } = a;
      agent = { ...rest, status: "live" };
      return { ok: true, slug: a.slug };
    },
    "launch:forOwner": () => agent && { owner: agent.owner, name: agent.name, ticker: agent.ticker, avatarSeed: agent.avatarSeed, status: agent.status, uid: agent.uid, arc: agent.arc, token: agent.token ?? null },
    "launch:recordToken": (a) => {
      if (agent!.token) return agent!.token.address === a.token.address ? "ok" : "has-token";
      agent!.token = a.token;
      return "ok";
    },
  };
  const run = async (f: any, a: any) => {
    const name = getFunctionName(f);
    calls.push([name, a]);
    return handlers[name](a);
  };
  return { cx: { client: { mutation: run, query: run } as any, secret: "s".repeat(20) }, calls, agent: () => agent };
}

const body = (over: Record<string, unknown> = {}) => CreateBody.parse({
  name: "Njord", ticker: "NJORD", thesis: "Back the favourite.",
  brain: { kind: "mimir" }, markets: { enabled: true }, ...over,
});
const wallets = { arc: async () => ({ id: "c1", address: "0x00000000000000000000000000000000000000ab" }) };

test("create: Base-only agents need no Arc wallet or Arc service", async () => {
  const f = fakeCx();
  const base = { id: "base-wallet", address: "0x00000000000000000000000000000000000000bc" };
  const r = await create(f.cx, { wallets: { base: async () => base }, checkKey: async () => "ok" }, OWNER, body());
  assert.deepEqual(r, { ok: true, id: "njord", arc: null, base: base.address });
  assert.equal(f.agent()!.arc, undefined);
  assert.deepEqual(f.agent()!.base, { walletId: base.id, address: base.address });
});

test("create: a failed sole Base wallet never stores an unusable agent", async () => {
  const f = fakeCx();
  const r = await create(f.cx, { wallets: { base: async () => { throw new Error("Circle unavailable"); } }, checkKey: async () => "ok" }, OWNER, body());
  assert.equal(r.ok, false);
  assert.deepEqual(f.calls, []);
});

test("create: free and live at once, with its Arc wallet; no funding step", async () => {
  const f = fakeCx();
  const r = await create(f.cx, { wallets, checkKey: async () => "ok" as const }, OWNER, body());
  assert.ok(r.ok);
  assert.deepEqual(r, { ok: true, id: "njord", arc: "0x00000000000000000000000000000000000000ab", base: null });
  const a = f.agent()!;
  assert.equal(a.status, "live");
  assert.deepEqual([a.arc.address, a.brain.kind, a.markets.enabled], ["0x00000000000000000000000000000000000000ab", "mimir", true]);
  assert.equal(a.markets.rules.minEdge, 0.08);
  assert.deepEqual(f.calls.map(([n]) => n), ["launch:create"], "one write, nothing to fund or verify");
  for (const k of ["fundLamports", "trading", "solana", "launch", "allocation", "venue"]) assert.ok(!(k in a), k);
});

test("create: a BYOK key is checked, then sealed to the agent's uid; a dead key makes no wallet", async () => {
  let made = 0;
  const w = { arc: async () => (made++, { id: "w", address: "0xa" }) };
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

test("body: nothing turned on is refused; old token and funding fields are ignored", () => {
  assert.equal(CreateBody.safeParse({ ...body(), markets: { enabled: false } }).success, false);
  const parsed = CreateBody.parse({ ...body(), seedSol: 1, chain: "solana", trading: { enabled: true } });
  assert.ok(!("seedSol" in parsed) && !("chain" in parsed) && !("trading" in parsed));
});

test("create: a council persona's ticker is refused before anything is made", async () => {
  let made = 0;
  const r = await create(fakeCx().cx, { wallets: { arc: async () => (made++, { id: "w", address: "0xa" }) }, checkKey: async () => "ok" as const }, OWNER, body({ ticker: "SOCRATES" }));
  assert.equal(r.ok, false);
  assert.equal(made, 0);
});

test("auth: the signed message binds action, agent and body; stale signatures are refused", async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const m = { action: "token" as const, owner: acct.address, agent: "njord", bodySha256: "ab", signedAt: Date.now() };
  const signature = await acct.signMessage({ message: launchMessage(m) });
  assert.ok(await verifyWalletSignature({ address: acct.address, message: launchMessage(m), signature }));
  assert.ok(!(await verifyWalletSignature({ address: acct.address, message: launchMessage({ ...m, agent: "odin" }), signature })));
  assert.ok(!(await verifyWalletSignature({ address: acct.address, message: launchMessage({ ...m, action: "status" }), signature })));
  assert.ok(!isFreshLaunchSig(Date.now() - 6 * 60_000));
});

// ───────────────────────────── the owner's token launch

const TOKEN = "0x9BBde5ef54604e06524605b42b20120Ab366E8DD";
const SPLITTER = "0xAb7AC90eC5f1fcE657265E03469671fb0A71309A";
const TX = keccak256("0x01");

function argusLogs(creator: string, symbol = "NJORD") {
  const poolId: Hex = keccak256("0x02");
  return [
    { address: ARGUS.portal, topics: encodeEventTopics({ abi: ARGUS_ABI, eventName: "TokenCreated", args: { token: TOKEN, creator: creator as Hex } }) as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }], ["Njord", symbol, poolId, "ipfs://x", "", "", ""]) },
    { address: ARGUS.portal, topics: encodeEventTopics({ abi: ARGUS_ABI, eventName: "PartsDeployed", args: { token: TOKEN } }) as [Hex, ...Hex[]],
      data: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], ["0x1111111111111111111111111111111111111111", "0x2Eab7E25EdACd4c3ba8C378c0Bb20eAA6E046044", SPLITTER]) },
  ];
}

function clankerLogs(admin: string, sender: string, symbol = "NJORD") {
  return [{
    address: CLANKER_FACTORY,
    topics: encodeEventTopics({ abi: CLANKER_EVENTS_ABI, eventName: "TokenCreated", args: { tokenAddress: TOKEN, tokenAdmin: admin as Hex } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "int24" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address[]" }],
      [sender as Hex, "ipfs://x", "Njord", symbol, "{}", '{"interface":"Mimir","id":"njord"}', 0, TOKEN, keccak256("0x03"), "0x4200000000000000000000000000000000000006", TOKEN, TOKEN, 0n, []],
    ),
  }];
}

const reader = (from: string, logs: ReturnType<typeof argusLogs> | ReturnType<typeof clankerLogs>, status: "success" | "reverted" = "success"): ReceiptReader => ({
  getTransaction: async () => ({ from: from as Hex }),
  getTransactionReceipt: async () => ({ status, logs }),
});

test("verify: an Argus launch from the owner, naming the owner as creator, is the agent's token (with its splitter)", async () => {
  const ok = await verifyTokenLaunch(reader(OWNER, argusLogs(OWNER)), { chain: "arc", tx: TX, owner: OWNER, ticker: "NJORD" });
  assert.deepEqual(ok, { ok: true, token: { chain: "arc", address: getAddress(TOKEN), splitter: getAddress(SPLITTER), launchTx: TX } });
});

test("verify: refused when someone else sent it, someone else is creator, the symbol differs, or it reverted", async () => {
  const v = (r: ReceiptReader) => verifyTokenLaunch(r, { chain: "arc", tx: TX, owner: OWNER, ticker: "NJORD" });
  assert.equal((await v(reader(STRANGER, argusLogs(OWNER)))).ok, false, "sender");
  assert.equal((await v(reader(OWNER, argusLogs(STRANGER)))).ok, false, "creator");
  assert.equal((await v(reader(OWNER, argusLogs(OWNER, "ODIN")))).ok, false, "symbol");
  assert.equal((await v(reader(OWNER, argusLogs(OWNER), "reverted"))).ok, false, "reverted");
  assert.equal((await v(reader(OWNER, clankerLogs(OWNER, OWNER)))).ok, false, "a Clanker log is not an Argus launch");
  const missing = await v({ getTransaction: async () => { throw new Error("not found"); }, getTransactionReceipt: async () => { throw new Error("not found"); } });
  assert.equal(missing.ok, false);
});

test("verify: a Clanker launch needs the owner as sender and token admin", async () => {
  const v = (from: string, logs: ReturnType<typeof clankerLogs>) => verifyTokenLaunch(reader(from, logs), { chain: "base", tx: TX, owner: OWNER, ticker: "NJORD" });
  assert.deepEqual(await v(OWNER, clankerLogs(OWNER, OWNER)), { ok: true, token: { chain: "base", address: getAddress(TOKEN), launchTx: TX } });
  assert.equal((await v(OWNER, clankerLogs(STRANGER, OWNER))).ok, false, "admin");
  assert.equal((await v(STRANGER, clankerLogs(OWNER, STRANGER))).ok, false, "sender");
  assert.equal((await v(OWNER, clankerLogs(OWNER, OWNER).map((l) => ({ ...l, address: STRANGER as Hex })))).ok, false, "not the factory");
});

test("record: only the owner, verified on chain, once; the same token again is fine", async () => {
  const f = fakeCx();
  await create(f.cx, { wallets, checkKey: async () => "ok" as const }, OWNER, body());
  const readers = { arc: reader(OWNER, argusLogs(OWNER)), base: reader(OWNER, clankerLogs(OWNER, OWNER)) };
  assert.equal((await recordTokenLaunch(f.cx, readers, STRANGER, "njord", { chain: "arc", tx: TX })).ok, false);
  const r = await recordTokenLaunch(f.cx, readers, OWNER, "njord", { chain: "arc", tx: TX });
  assert.ok(r.ok);
  assert.deepEqual(f.agent()!.token, { chain: "arc", address: getAddress(TOKEN), splitter: getAddress(SPLITTER), launchTx: TX });
  assert.ok((await recordTokenLaunch(f.cx, readers, OWNER, "njord", { chain: "arc", tx: TX })).ok);
});

test("prepare: Argus needs a tax; the launch tx is built for the owner's wallet as creator, never the agent's", async () => {
  assert.equal(TokenPrepareBody.safeParse({ chain: "arc" }).success, false);
  assert.equal(TokenPrepareBody.safeParse({ chain: "arc", argus: { buyTaxBps: 0, sellTaxBps: 0 } }).success, false);
  const f = fakeCx();
  await create(f.cx, { wallets, checkKey: async () => "ok" as const }, OWNER, body());
  let creator = "";
  let owner = "";
  const deps = {
    image: async () => "data:image/png;base64,AA==",
    pin: async () => "ipfs://img",
    argus: async (c: string, _uid: string, params: { p: { creatorBps: number } }) => {
      creator = c;
      assert.equal(params.p.creatorBps, 10000);
      return { data: "0xabcd" as Hex, token: TOKEN as Hex };
    },
    arcChainId: 5042,
    clanker: async (a: { owner: string }) => ((owner = a.owner), { to: CLANKER_FACTORY, data: "0x1234" as Hex, value: 0n, expectedAddress: TOKEN as Hex }),
    site: "https://mimir.test",
  };
  const arc = await prepareTokenLaunch(f.cx, deps, OWNER, "njord", TokenPrepareBody.parse({ chain: "arc", argus: { buyTaxBps: 200, sellTaxBps: 200 } }));
  assert.ok(arc.ok);
  assert.equal(creator, getAddress(OWNER));
  assert.deepEqual(arc.ok && [arc.chainId, arc.to, arc.data, arc.value], [5042, ARGUS.portal, "0xabcd", "0x0"]);
  const base = await prepareTokenLaunch(f.cx, deps, OWNER, "njord", TokenPrepareBody.parse({ chain: "base" }));
  assert.ok(base.ok);
  assert.equal(owner, getAddress(OWNER));
  assert.deepEqual(base.ok && [base.chainId, base.to], [8453, CLANKER_FACTORY]);
  assert.equal((await prepareTokenLaunch(f.cx, deps, STRANGER, "njord", TokenPrepareBody.parse({ chain: "base" }))).ok, false);
});
