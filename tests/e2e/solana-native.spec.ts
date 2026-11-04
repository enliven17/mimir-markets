import { createHash, randomUUID } from "node:crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { test, expect } from "./fixtures";
import { launchMessage } from "../../lib/launch/auth";
import {
  agentRequestMessage,
  operatorProofMessage,
  type AgentAction,
  type AgentEnvelope,
} from "../../lib/agents/api";

const signature = (key: Keypair, message: string) =>
  bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), key.secretKey),
  );
const signedHeaders = (
  key: Keypair,
  action: "create" | "status" | "copy",
  agent: string,
  body: unknown,
) => {
  const owner = key.publicKey.toBase58(),
    signedAt = Date.now();
  const message = launchMessage({
    owner,
    action,
    agent,
    signedAt,
    bodySha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  });
  return {
    "x-mimir-owner": owner,
    "x-mimir-signed-at": String(signedAt),
    "x-mimir-signature": signature(key, message),
  };
};

test("Solana wallet sheet, program links and responsive shell", async ({
  page,
}, info) => {
  await page.goto("/en");
  await expect(page.locator(".devnet-notice")).toContainText("Solana Devnet");
  const banner = await page.locator(".devnet-notice").boundingBox(),
    nav = await page.locator(".nav-shell").boundingBox();
  expect(banner).not.toBeNull();
  expect(nav).not.toBeNull();
  expect(nav!.y).toBeGreaterThanOrEqual(banner!.y + banner!.height - 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: info.outputPath("solana-home.png"),
    fullPage: false,
  });
  // Terms/product notices use the same shell; close them through their visible controls.
  for (const name of [
    /Accept and continue/i,
    /I understand/i,
    /Got it/i,
    /Explore markets/i,
    /Continue/i,
  ]) {
    const button = page.getByRole("dialog").getByRole("button", { name });
    if ((await button.count()) === 1 && (await button.isVisible()))
      await button.click();
  }
  await page.goto("/en/arena/create");
  const connect = page.getByRole("button", {
    name: "Connect wallet",
    exact: true,
  });
  await connect.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Phantom");
  await expect(page.getByRole("dialog")).not.toContainText("MetaMask");
  await expect(page.getByRole("dialog")).not.toContainText("Coinbase");
});

test("free native agent creation binds signatures and keeps wallet seals private", async ({
  request,
}) => {
  const owner = Keypair.generate(),
    other = Keypair.generate();
  const ticker = `QA${Date.now().toString(36).slice(-7)}`.toUpperCase();
  const body = {
    name: "Solana QA Agent",
    ticker,
    thesis: "Only take well-supported positions.",
    brain: { kind: "mimir" },
    markets: {
      enabled: true,
      maxStakeUsdc: 2,
      budgetUsdc: 4,
      create: { enabled: false, perDay: 1 },
    },
  };
  const headers = signedHeaders(owner, "create", "new", body);
  const tampered = await request.post("/api/launch", {
    headers,
    data: { ...body, ticker: "TAMPERED" },
  });
  expect(tampered.status()).toBe(401);
  const created = await request.post("/api/launch", { headers, data: body });
  expect(created.status(), await created.text()).toBe(200);
  const result = await created.json();
  expect(new PublicKey(result.solana).toBase58()).toBe(result.solana);
  expect(result.arc).toBeNull();
  expect(result.base).toBeNull();
  const replay = await request.post("/api/launch", { headers, data: body });
  expect(replay.status()).toBe(409);
  const id = result.id as string;
  const detail = await request.get(`/api/launch/${id}/detail`);
  expect(detail.status()).toBe(200);
  expect(await detail.text()).not.toMatch(/"(?:sealed|walletId|uid|secret)"/);
  const status = { status: "paused" };
  const wrongOwner = await request.post(`/api/launch/${id}/status`, {
    headers: signedHeaders(other, "status", id, status),
    data: status,
  });
  expect(wrongOwner.ok()).toBe(false);
  const copy = { active: true, solana: { on: true, maxPerStakeUsdc: 2 } };
  const started = await request.post(`/api/launch/${id}/copy`, {
    headers: signedHeaders(other, "copy", id, copy),
    data: copy,
  });
  expect(started.status(), await started.text()).toBe(200);
  const sub = await request.get(
    `/api/launch/${id}/copy?follower=${other.publicKey.toBase58()}`,
  );
  expect(sub.status()).toBe(200);
  expect(await sub.text()).not.toMatch(/"(?:sealed|walletId|uid|secret)"/);
  const stopped = { active: false, solana: { on: false, maxPerStakeUsdc: 2 } };
  expect(
    (
      await request.post(`/api/launch/${id}/copy`, {
        headers: signedHeaders(other, "copy", id, stopped),
        data: stopped,
      })
    ).status(),
  ).toBe(200);
  const killed = { status: "killed" };
  expect(
    (
      await request.post(`/api/launch/${id}/status`, {
        headers: signedHeaders(owner, "status", id, killed),
        data: killed,
      })
    ).status(),
  ).toBe(200);
});

test("external agent API returns unsigned native devnet transactions", async ({
  request,
}) => {
  const key = Keypair.generate(),
    address = key.publicKey.toBase58(),
    agentId = `qa-native-${randomUUID().slice(0, 8)}`;
  const post = async (action: AgentAction, body: Record<string, unknown>) => {
    const envelope: AgentEnvelope = {
      version: "v1",
      agentId,
      action,
      nonce: randomUUID(),
      idempotencyKey: randomUUID(),
      signedAt: Date.now(),
      body,
    };
    envelope.signature = signature(key, agentRequestMessage(envelope));
    return request.post(`/api/agents/v1/${action}`, { data: envelope });
  };
  const reg = await post("register", {
    ownerWallet: address,
    operatorWallet: address,
    payoutWallet: address,
    arcOperator: address,
    displayName: "Native QA Operator",
    authorityLevel: 3,
    capabilities: ["market_creator", "council_juror"],
    operatorSignature: signature(key, operatorProofMessage(agentId, address)),
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const quote = await post("dryRun", {
    action: "challenge",
    stakeUsdc: 2,
    expectedPayoutUsdc: 4,
  });
  expect(quote.status(), await quote.text()).toBe(200);
  const quoted = await quote.json();
  expect(quoted.feeQuote.policy.platformFeeBps).toBeGreaterThanOrEqual(0);
  expect(Number(quoted.feeQuote.netPayoutUsdc)).toBeLessThanOrEqual(4);
  const prepared = await post("createClaim", {
    chain: "solana",
    kind: "vs",
    question: "Will Bitcoin trade above $100,000 at the deadline?",
    creatorPosition: "Yes",
    counterPosition: "No",
    resolutionUrl: "https://www.coingecko.com/en/coins/bitcoin",
    category: "crypto",
    stakeUsdc: 2,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    maxChallengers: 16,
  });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const result = await prepared.json();
  expect(result.chain).toBe("solana");
  expect(result.transactions.length).toBe(1);
  const p = result.transactions[0];
  expect(p.genesisHash).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  const tx = Transaction.from(Buffer.from(p.transaction, "base64"));
  expect(tx.feePayer?.toBase58()).toBe(address);
  expect(tx.signatures.every((s) => s.signature === null)).toBe(true);
  expect(tx.instructions[0].programId.toBase58()).toBe(
    "EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE",
  );
  const wrongChain = await post("createClaim", { chain: "base", stakeUsdc: 2 });
  expect(wrongChain.ok()).toBe(false);
  expect((await post("revoke", {})).status()).toBe(200);
});
