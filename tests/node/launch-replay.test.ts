import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { privateKeyToAccount } from "viem/accounts";
import { launchMessage, LAUNCH_HEADERS, LAUNCH_SIG_TTL_MS, type LaunchAction } from "../../lib/launch/auth";

test("Launch authorization is consumed once across encodings, windows and server instances", async t => {
  const root = resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(join(tmpdir(), "mimir-launch-replay-"));
  const oldNow = Date.now;
  const envKeys = ["MIMIR_STORE_SECRET", "NEXT_PUBLIC_CONVEX_URL", "MIMIR_BACKEND_OFF"] as const;
  const oldEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
  const secret = "fixture-store-secret-not-real";
  const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
  let now = 1_800_000_599_999;
  try {
    const entry = `export {readSigned} from './lib/launch/request';export {useMemoryStore} from './lib/server/store';export {memoryBackend} from './tests/helpers/convex-memory';export {tx,sweep} from './convex/appStore';export {verifyOwnerSignature} from './lib/owner';`;
    const out = join(temp, "request.mjs");
    await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, outfile: out, bundle: true, platform: "node", format: "esm", tsconfig: join(root, "tsconfig.json"), plugins: [{ name: "server-only-test", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "", loader: "js" }));
    } }] });
    const a = await import(pathToFileURL(out).href + "?server=a");
    const b = await import(pathToFileURL(out).href + "?server=b");
    Date.now = () => now;
    process.env.MIMIR_STORE_SECRET = secret;
    process.env.MIMIR_BACKEND_OFF = "0";
    let db: ReturnType<typeof a.memoryBackend>;
    let adapter: any;
    const reset = () => {
      db = a.memoryBackend();
      let serial = Promise.resolve();
      // Convex mutations serialize conflicting writes; run the actual mutation in that same order here.
      adapter = { tx: (steps: unknown[]) => {
        const next = serial.then(() => db.run(a.tx, { secret, steps }));
        serial = next.then(() => undefined, () => undefined);
        return next;
      } };
      a.useMemoryStore(adapter);b.useMemoryStore(adapter);
    };
    const authorization = async (options: { action?: LaunchAction; agent?: string; body?: string; signedAt?: number } = {}) => {
      const action = options.action ?? "withdraw", agent = options.agent ?? "fixture-agent", body = options.body ?? '{"amount":"1"}', signedAt = options.signedAt ?? now;
      const message = launchMessage({ action, owner: account.address, agent, signedAt, bodySha256: createHash("sha256").update(body).digest("hex") });
      const signature = await account.signMessage({ message });
      return { action, agent, body, signedAt, signature, message };
    };
    type Auth = Awaited<ReturnType<typeof authorization>>;
    const request = (auth: Auth, signature = auth.signature, owner = account.address) => new Request("https://example.invalid", { method: "POST", body: auth.body, headers: { [LAUNCH_HEADERS.owner]: owner, [LAUNCH_HEADERS.signedAt]: String(auth.signedAt), [LAUNCH_HEADERS.signature]: signature } });
    const read = (instance: typeof a, auth: Auth, signature = auth.signature, owner = account.address) => instance.readSigned(request(auth, signature, owner), auth.action, auth.agent);
    const status = (r: any) => r.ok ? 200 : r.res.status;

    await t.test("same signature, hex case and normalized owner share one authorization", async () => {
      reset();const auth = await authorization();
      assert.equal(status(await read(a, auth)), 200);
      assert.equal(status(await read(a, auth)), 409);
      assert.equal(status(await read(b, auth, `0x${auth.signature.slice(2).toUpperCase()}`)), 409);
      assert.equal(status(await read(b, auth, auth.signature, account.address.toLowerCase() as typeof account.address)), 409);
      const rows = await db.db.query("appStore").collect();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].t, "launch_authorizations");
      assert.equal(rows[0].k, createHash("sha256").update(auth.message).digest("hex"));
      assert.equal(rows[0].at, auth.signedAt + LAUNCH_SIG_TTL_MS);
      assert.equal(rows[0].d.expiresAt, rows[0].at);
      assert.ok(!JSON.stringify(rows).includes(auth.signature));
    });
    await t.test("another valid recovery-byte representation cannot replay the message", async () => {
      reset();const auth = await authorization();
      const v = Number.parseInt(auth.signature.slice(-2), 16);
      const alternative = `${auth.signature.slice(0, -2)}${(v >= 27 ? v - 27 : v + 27).toString(16).padStart(2, "0")}` as typeof auth.signature;
      assert.equal(await a.verifyOwnerSignature({ address: account.address, message: auth.message, signature: alternative }), true);
      assert.equal(status(await read(a, auth)), 200);
      assert.equal(status(await read(b, auth, alternative)), 409);
    });
    await t.test("a fixed-window boundary and a newly loaded server do not reset consumption", async () => {
      reset();now = 1_800_000_599_999;const auth = await authorization();
      assert.equal(status(await read(a, auth)), 200);
      now += 2;
      assert.equal(status(await read(b, auth)), 409);
    });
    await t.test("concurrent duplicate admissions permit exactly one operation", async () => {
      reset();const auth = await authorization();
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => read(i % 2 ? a : b, auth)));
      assert.equal(results.filter((r: any) => r.ok).length, 1);
      assert.equal(results.filter((r: any) => !r.ok && r.res.status === 409).length, 9);
    });
    await t.test("legitimate independent actions, agents, bodies and timestamps remain usable", async () => {
      reset();
      for (const action of ["create", "token", "status", "withdraw", "copy", "copy-withdraw", "follow"] as const) {
        assert.equal(status(await read(a, await authorization({ action }))), 200);
      }
      for (const options of [{ agent: "another-agent" }, { body: '{"amount":"2"}' }, { signedAt: now - 1 }]) {
        assert.equal(status(await read(b, await authorization(options))), 200);
      }
    });
    await t.test("expired and overly future signatures fail; inclusive expiry and permitted skew still work", async () => {
      reset();
      assert.equal(status(await read(a, await authorization({ signedAt: now - LAUNCH_SIG_TTL_MS - 1 }))), 401);
      assert.equal(status(await read(a, await authorization({ signedAt: now + 60_001 }))), 401);
      assert.equal(status(await read(a, await authorization({ signedAt: now - LAUNCH_SIG_TTL_MS }))), 200);
      assert.equal(status(await read(a, await authorization({ signedAt: now + 60_000 }))), 200);
    });
    await t.test("invalid binding cannot consume the legitimate authorization", async () => {
      reset();const auth = await authorization();
      assert.equal(status(await read(a, { ...auth, body: '{"amount":"999"}' })), 401);
      assert.equal(status(await read(a, auth)), 200);
    });
    await t.test("backend failure and missing configuration fail closed without memory fallback", async () => {
      reset();const auth = await authorization();
      a.useMemoryStore({ tx: async () => { throw Error("fixture backend unavailable"); } });
      assert.equal(status(await read(a, auth)), 503);
      a.useMemoryStore(null);
      delete process.env.NEXT_PUBLIC_CONVEX_URL;
      assert.equal(status(await read(a, auth)), 503);
      a.useMemoryStore(adapter);
      assert.equal(status(await read(a, auth)), 200);
    });
    await t.test("a request that expires during asynchronous verification is not admitted", async () => {
      reset();const auth = await authorization();
      const pending = read(a, auth);
      now = auth.signedAt + LAUNCH_SIG_TTL_MS + 1;
      assert.equal(status(await pending), 401);
    });
    await t.test("a request that expires while the ledger responds cannot reach its action", async () => {
      reset();const auth = await authorization();const underlying = adapter.tx;
      a.useMemoryStore({ tx: async (steps: unknown[]) => { const result = await underlying(steps);now = auth.signedAt + LAUNCH_SIG_TTL_MS + 1;return result; } });
      assert.equal(status(await read(a, auth)), 401);
    });
    await t.test("cleanup retains records through inclusive expiry and removes them conservatively later", async () => {
      reset();const auth = await authorization();
      assert.equal(status(await read(a, auth)), 200);
      now = auth.signedAt + LAUNCH_SIG_TTL_MS;
      await db.run(a.sweep, {});
      assert.equal((await db.db.query("appStore").collect()).length, 1);
      assert.equal(status(await read(b, auth)), 409);
      now += 2 * 86_400_000 + 1;
      await db.run(a.sweep, {});
      assert.deepEqual(await db.db.query("appStore").collect(), []);
      assert.equal(status(await read(b, auth)), 401);
    });
  } finally {
    Date.now = oldNow;
    for (const key of envKeys) { if (oldEnv[key] === undefined) delete process.env[key];else process.env[key] = oldEnv[key]; }
    await rm(temp, { recursive: true, force: true });
  }
});
