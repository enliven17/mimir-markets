import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { demoCookie, newDemoToken, readDemoToken, sameDemoOrigin, sessionHash, walletDemoToken, matchesDemoWallet } from "../../lib/demo/session";
import { PREVIEW_OWNER_HEADER, previewWalletMessage, verifiedPreviewOwner } from "../../lib/demo/auth";
import { LAUNCH_HEADERS } from "../../lib/launch/auth";
import { signAgentMessage } from "../../lib/agents/signature";
import { Keypair } from "@solana/web3.js";
import { demoRouter } from "../../lib/demo/router";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { ...process.env }; process.env.DEMO_GEMINI_API_KEY = "demo-key"; });
afterEach(() => { process.env = env; });

test("preview sign-in needs a fresh signature from the claimed wallet", () => {
  const a = Keypair.generate(), b = Keypair.generate(); const owner = a.publicKey.toBase58(); const at = Date.now();
  const request = (address: string, signedAt: number, message = previewWalletMessage(owner, signedAt)) => new Request("https://mimirmarkets.xyz/api/demo", { headers: {
    [PREVIEW_OWNER_HEADER]: address, [LAUNCH_HEADERS.signedAt]: String(signedAt), [LAUNCH_HEADERS.signature]: signAgentMessage(message, a.secretKey),
  } });
  assert.equal(verifiedPreviewOwner(request(owner, at)), owner);
  assert.equal(verifiedPreviewOwner(request(b.publicKey.toBase58(), at)), null);
  assert.equal(verifiedPreviewOwner(request(owner, at - 600_000)), null);
  assert.equal(verifiedPreviewOwner(request(owner, at, "Mimir Launch")), null);
  assert.equal(verifiedPreviewOwner(new Request("https://mimirmarkets.xyz/api/demo")), null);
});

test("preview cookies are bound to a verified wallet and the server secret", () => {
  const owner = Keypair.generate().publicKey.toBase58(); const token = walletDemoToken(owner, "secret-one");
  assert.equal(matchesDemoWallet(token, owner, "secret-one"), true);
  assert.equal(matchesDemoWallet(token, "another-wallet", "secret-one"), false);
  assert.equal(matchesDemoWallet(token, owner, "secret-two"), false);
  assert.equal(matchesDemoWallet(null, owner, "secret-one"), false);
  assert.equal(matchesDemoWallet(newDemoToken(), owner, "secret-one"), false);
});

test("guest credentials are random, hashed at rest and sent only in a scoped HttpOnly cookie", () => {
  const token = newDemoToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, newDemoToken());
  assert.notEqual(sessionHash(token), token);
  assert.equal(sessionHash(token), sessionHash(token));
  const cookie = demoCookie(token, true);
  for (const flag of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/api/demo", "Max-Age=604800"]) assert.ok(cookie.includes(flag));
  assert.equal(readDemoToken(new Request("https://example.test/api/demo", { headers: { cookie } })), token);
  assert.equal(readDemoToken(new Request("https://example.test/api/demo", { headers: { cookie: "mimir_demo=forged" } })), null);
});

test("demo mutations reject cross-origin, opaque and missing-origin requests", () => {
  for (const origin of ["https://evil.test", "null", ""]) assert.equal(sameDemoOrigin(new Request("https://mimir.test/api/demo", { headers: { origin } })), false);
  assert.equal(sameDemoOrigin(new Request("https://mimir.test/api/demo", { headers: { origin: "https://mimir.test", "sec-fetch-site": "same-origin" } })), true);
  assert.equal(sameDemoOrigin(new Request("https://mimir.test/api/demo", { headers: { origin: "https://mimir.test", "sec-fetch-site": "cross-site" } })), false);
});

const prompt = { system: "system", user: "thesis", maxTokens: 8_192 };
test("a preview uses its recorded model after the deployment default changes", async () => {
  process.env.DEMO_GEMINI_MODEL = "new-default";
  let url = "";
  const router = demoRouter(async () => true, async (u) => { url = String(u); return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }); }, "pinned-model");
  await router.completeJson(prompt, (v) => v);
  assert.match(url, /models\/pinned-model:/); assert.equal(url.includes("new-default"), false);
});
test("exhausted AI allowance causes zero outbound requests", async () => {
  let requests = 0;
  const router = demoRouter(async () => false, async () => { requests++; return new Response(); });
  await assert.rejects(router.completeJson(prompt, (v) => v), /allowance/);
  assert.equal(requests, 0);
});

test("a provider failure consumes at most one reserved request, without retries or fallback keys", async () => {
  let reservations = 0, requests = 0;
  const router = demoRouter(async () => { reservations++; return true; }, async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.maxOutputTokens, 1_024);
    return new Response("quota", { status: 429 });
  });
  await assert.rejects(router.completeJson(prompt, (v) => v), /429/);
  assert.equal(reservations, 1); assert.equal(requests, 1);
});

test("missing demo credentials never spend the live or oracle keys", async () => {
  delete process.env.DEMO_GEMINI_API_KEY;
  process.env.LAUNCH_GEMINI_API_KEY = "live-key"; process.env.ORACLE_GEMINI_API_KEY = "oracle-key";
  let requests = 0, reservations = 0;
  const router = demoRouter(async () => { reservations++; return true; }, async () => { requests++; return new Response(); });
  await assert.rejects(router.completeJson(prompt, (v) => v), /unavailable/);
  assert.equal(requests, 0); assert.equal(reservations, 0);
});
