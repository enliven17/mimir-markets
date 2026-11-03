import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getFunctionName } from "convex/server";
import { callIdFor, PAID_TOPIC } from "../../lib/launch/paid-call";

/** Real public route, backend payment checks and claim/retry ledger; only remote/config boundaries are fixtures. */
test("paid API routes enforce private redemption on Arc and retain Base behavior", async t => {
  const root = resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(join(tmpdir(), "mimir-paid-api-"));
  const pay = "0x3333333333333333333333333333333333333333";
  const agent = "0x1111111111111111111111111111111111111111";
  const secret = `0x${"5e".repeat(32)}`;
  const tx = `0x${"ab".repeat(32)}`;
  const log = (over = {}) => ({ address: pay, topics: [PAID_TOPIC, callIdFor(secret), `0x${"0".repeat(24)}${agent.slice(2)}`, `0x${"0".repeat(24)}${agent.slice(2)}`], data: `0x${50000n.toString(16)}`, ...over });
  const f: any = {
    chains: { arc: { enabled: true, network: "mainnet", label: "Arc" }, base: { enabled: true, network: "mainnet", label: "Base" } },
    agent: { name: "Fixture", ticker: "FIX", thesis: "fixture", uid: "", id: null, arc: agent, base: agent, brain: { kind: "mimir" }, recent: [] },
    logs: [log()], failedAnswer: false, receipts: 0,
  };
  f.rpc = { getTransactionReceipt: async () => { f.receipts++;return { status: "success", blockNumber: 1n, logs: f.logs }; }, getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) }) };
  f.router = { completeJson: async () => { if (f.failedAnswer) throw Error("unavailable");return { data: "fixture answer" }; } };
  const globals = globalThis as typeof globalThis & { __mimirPaidApi?: any };
  const previous = globals.__mimirPaidApi;
  globals.__mimirPaidApi = f;
  const oldEnv = { arc: process.env.ARC_AGENT_PAY_ADDRESS, base: process.env.BASE_AGENT_PAY_ADDRESS };
  const remotes: Record<string, string> = {
    "lib/chains/registry": "const f=globalThis.__mimirPaidApi;export const MARKET_CHAINS={chains:f.chains};export const serverMarketChains=()=>MARKET_CHAINS;",
    "lib/launch/request": "const f=globalThis.__mimirPaidApi;export const launchCx=()=>({secret:'internal',client:{query:async()=>f.agent,action:async(_,a)=>f.backend(f.ctx,a)}});",
    "lib/server/rate-limit": "export const allowRequest=async()=>true;export const clientIp=()=> 'fixture';",
    "lib/internal-secrets": "export const secretMatches=(_,s)=>s==='internal';",
    "lib/launch/byok": "export const byokRouter=()=>globalThis.__mimirPaidApi.router;",
    "lib/launch/llm": "export const platformRouter=globalThis.__mimirPaidApi.router;",
    "lib/arc/chain": "export const arcPublicClient=()=>globalThis.__mimirPaidApi.rpc;",
    "lib/arc/config": "export const arcConfig=()=>({});",
    "convex/marketDeploymentGuard": "export const assertMarketDeployment=async()=>{};",
    viem: `export * from ${JSON.stringify(join(root, "node_modules/viem/_esm/index.js"))};export const createPublicClient=()=>globalThis.__mimirPaidApi.rpc;`,
  };
  try {
    const out = join(temp, "api.mjs");
    await build({ stdin: { contents: `export {GET,POST} from './app/api/launch/[id]/call/route';export {call} from './convex/agentApi';export {claim,release,done} from './convex/agentApiDb';export {memoryBackend} from './tests/helpers/convex-memory';`, resolveDir: root, loader: "ts" }, outfile: out, bundle: true, platform: "node", format: "esm", tsconfig: join(root, "tsconfig.json"), plugins: [{ name: "remote-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, a => {
        const key = a.path === "viem" ? "viem" : a.path.startsWith("@/") ? a.path.slice(2) : resolve(a.resolveDir, a.path).slice(root.length + 1);
        if (key in remotes) return { path: key, namespace: "fixture" };
      });
      b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: remotes[a.path], loader: "js", resolveDir: root }));
    } }] });
    const m = await import(pathToFileURL(out).href);
    const ledger = m.memoryBackend();
    f.ctx = { runQuery: async () => f.agent, runMutation: async (ref: any, a: any) => {
      const name = getFunctionName(ref).split(":")[1];
      assert.ok(["claim", "done", "release"].includes(name));
      return ledger.run(m[name], a);
    } };
    f.backend = m.call._handler;
    process.env.BASE_AGENT_PAY_ADDRESS = pay;
    delete process.env.ARC_AGENT_PAY_ADDRESS;
    const params = { params: Promise.resolve({ id: "fixture" }) };
    const backend = (over = {}) => f.backend(f.ctx, { secret: "internal", slug: "fixture", prompt: "hello", chain: "arc", tx, callSecret: secret, ...over });

    await t.test("quotes disable unconfigured Arc and retain configured Base", async () => {
      const q = await (await m.GET(new Request("https://example.invalid"), params)).json();
      assert.deepEqual(q.accepts.map((o: any) => o.chain), ["base"]);
      assert.equal((await backend()).status, 400);
      assert.equal(f.receipts, 0);
    });
    await t.test("configured Arc quote includes a private commitment; testnet is not offered", async () => {
      process.env.ARC_AGENT_PAY_ADDRESS = pay;
      const q = await (await m.GET(new Request("https://example.invalid"), params)).json();
      assert.deepEqual(q.accepts.map((o: any) => o.chain), ["arc", "base"]);
      for (const o of q.accepts) { assert.equal(o.payTo, pay);assert.equal(o.agent, agent);assert.equal(callIdFor(o.secret), o.callId); }
      assert.notEqual(q.accepts[0].secret, q.accepts[1].secret);
      f.chains.arc.network = "testnet";
      assert.deepEqual((await (await m.GET(new Request("https://example.invalid"), params)).json()).accepts.map((o: any) => o.chain), ["base"]);
      assert.equal((await backend()).status, 503);
      f.chains.arc.network = "mainnet";
    });
    await t.test("public hash-only calls and backend missing-secret calls never reach redemption", async () => {
      const r = await m.POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ prompt: "hello" }), headers: { "x-mimir-payment": `arc:${tx}` } }), params);
      assert.equal(r.status, 402);
      assert.equal((await backend({ callSecret: undefined })).status, 400);
      assert.equal(f.receipts, 0);
    });
    await t.test("wrong secret and look-alike contracts do not consume a receipt", async () => {
      assert.equal((await backend({ callSecret: `0x${"77".repeat(32)}` })).status, 402);
      f.logs = [log({ address: agent })];assert.equal((await backend()).status, 402);
      f.logs = [log()];
      assert.deepEqual(await ledger.db.query("agentApiPayments").collect(), []);
    });
    await t.test("Arc successful redemption is one-use even with uppercase hash encoding", async () => {
      const r = await m.POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ prompt: "hello" }), headers: { "x-mimir-payment": `arc:${tx}:${secret}` } }), params);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).answer, "fixture answer");
      assert.equal((await backend({ tx: `0x${tx.slice(2).toUpperCase()}` })).status, 409);
    });
    await t.test("a failed answer releases its payment for a legitimate retry", async () => {
      const another = `0x${"bc".repeat(32)}`;
      f.failedAnswer = true;assert.equal((await backend({ tx: another })).status, 502);
      f.failedAnswer = false;assert.equal((await backend({ tx: another })).ok, true);
      assert.equal((await backend({ tx: another })).status, 409);
    });
    await t.test("Base still redeems the matching private commitment once", async () => {
      assert.equal((await backend({ chain: "base" })).ok, true);
      assert.equal((await backend({ chain: "base" })).status, 409);
    });
  } finally {
    globals.__mimirPaidApi = previous;
    for (const [key, value] of [["ARC_AGENT_PAY_ADDRESS", oldEnv.arc], ["BASE_AGENT_PAY_ADDRESS", oldEnv.base]]) {
      if (value === undefined) delete process.env[key!];else process.env[key!] = value;
    }
    await rm(temp, { recursive: true, force: true });
  }
});
