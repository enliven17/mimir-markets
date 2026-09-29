import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";

import { agentRequestMessage, operatorProofMessage, validateAgentRequestEnvelope } from "../../lib/agents/api";
import { verifyAgentSignature } from "../../lib/agents/signature";
import { MimirAgentClient, keypairSigner, registerAgent } from "../../sdk/agents";
import { followMessage } from "../../lib/baskets";

function capture() {
  const sent: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

test("registerAgent sends an envelope the server's own checks accept", async () => {
  const owner = Keypair.generate();
  const operator = Keypair.generate();
  const { sent, fetchImpl } = capture();
  await registerAgent({
    baseUrl: "http://mimir.test/",
    agentId: "my-agent",
    ownerWallet: owner.publicKey.toBase58(),
    operatorWallet: operator.publicKey.toBase58(),
    signWithOwner: keypairSigner(owner),
    signWithOperator: keypairSigner(operator),
    fetchImpl,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "http://mimir.test/api/agents/v1/register");
  const env = validateAgentRequestEnvelope(sent[0].body, { action: "register" });
  assert.equal(
    verifyAgentSignature({
      address: owner.publicKey.toBase58(),
      message: agentRequestMessage(env),
      signature: env.signature ?? "",
    }),
    true,
    "owner signature",
  );
  assert.equal(
    verifyAgentSignature({
      address: operator.publicKey.toBase58(),
      message: operatorProofMessage("my-agent", operator.publicKey.toBase58()),
      signature: String(env.body.operatorSignature),
    }),
    true,
    "operator proof",
  );
});

test("with an API key the client sends a bearer header and no signature", async () => {
  const { sent, fetchImpl } = capture();
  const client = new MimirAgentClient({ baseUrl: "http://mimir.test", agentId: "my-agent", apiKey: "mk_live_x", fetchImpl });
  await client.heartbeat();
  assert.equal(sent[0].headers.authorization, "Bearer mk_live_x");
  assert.equal(sent[0].body.signature, undefined);
});

test("without a key the operator signs; owner-gated calls are signed by the owner and carry no key", async () => {
  const owner = Keypair.generate();
  const operator = Keypair.generate();
  const { sent, fetchImpl } = capture();
  const client = new MimirAgentClient({
    baseUrl: "http://mimir.test",
    agentId: "my-agent",
    operator,
    signWithOwner: keypairSigner(owner),
    fetchImpl,
  });
  await client.getBalances();
  await client.issueKey("ci");
  const [read, issue] = sent.map((s) => validateAgentRequestEnvelope(s.body, { action: String(s.body.action) }));
  assert.equal(
    verifyAgentSignature({ address: operator.publicKey.toBase58(), message: agentRequestMessage(read), signature: read.signature ?? "" }),
    true,
  );
  assert.equal(
    verifyAgentSignature({ address: owner.publicKey.toBase58(), message: agentRequestMessage(issue), signature: issue.signature ?? "" }),
    true,
  );
  assert.equal(sent[1].headers.authorization, undefined);
});

test("followBasket signs a timestamped follow with the operator key", async () => {
  const operator = Keypair.generate();
  const { sent, fetchImpl } = capture();
  const client = new MimirAgentClient({ baseUrl: "http://mimir.test", agentId: "my-agent", operator, fetchImpl });
  await client.followBasket("contrarian-mix", 5);
  assert.equal(sent[0].url, "http://mimir.test/api/baskets/contrarian-mix/subscribe");
  const body = sent[0].body as { follower: string; perMarketCapUsdc: number; signedAt: number; signature: string };
  assert.equal(body.follower, operator.publicKey.toBase58());
  assert.ok(Math.abs(Date.now() - body.signedAt) < 5_000);
  assert.ok(
    verifyAgentSignature({
      address: body.follower,
      message: followMessage({ basketId: "contrarian-mix", follower: body.follower, perMarketCapUsdc: 5, signedAt: body.signedAt }),
      signature: body.signature,
    }),
  );
});
