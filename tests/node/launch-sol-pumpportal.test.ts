import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { createPumpPortal } from "../../lib/launch/solana/pumpportal";
import { bytes, json, recordingFetch } from "../../lib/launch/solana/testkit";

const WALLET = Keypair.generate().publicKey.toBase58();
const MINT = "5dn8Bz1Kx8d9SdCgvHPiYLwCoUhGU1Hfdq47vSbWpump";
const TX = new Uint8Array(400).fill(1);
const CID = "bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra";
const PNG = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;

function setup(reply?: (url: string) => Response) {
  const rec = recordingFetch((c) => (reply ? reply(c.url) : c.url.includes("pinata") ? json({ data: { cid: CID } }) : bytes(TX)));
  const pp = createPumpPortal({ fetch: rec.fetch, pinataJwt: "jwt-secret", priorityFeeLamports: BigInt(100_000) });
  return { pp, calls: rec.calls };
}

test("buy: trade-local JSON with SOL amount, percent slippage, SOL priority fee, pool pump", async () => {
  const { pp, calls } = setup();
  assert.deepEqual(await pp.buildTradeTx({ wallet: WALLET, mint: MINT, side: "buy", amount: BigInt(123_456_789), decimals: 9, slippageBps: 1500 }), TX);
  assert.equal(calls[0].url, "https://pumpportal.fun/api/trade-local");
  assert.equal((calls[0].init.headers as Record<string, string>)["content-type"], "application/json");
  assert.deepEqual(calls[0].body, { publicKey: WALLET, action: "buy", mint: MINT, amount: 0.123456789, denominatedInSol: "true", slippage: 15, priorityFee: 0.0001, pool: "pump" });
});

test("sell: token amount in UI units, or 100% for the whole balance", async () => {
  const { pp, calls } = setup();
  await pp.buildTradeTx({ wallet: WALLET, mint: MINT, side: "sell", amount: BigInt(1_500_000), decimals: 6, slippageBps: 100 });
  await pp.buildTradeTx({ wallet: WALLET, mint: MINT, side: "sell", amount: "all", decimals: 6, slippageBps: 100 });
  assert.deepEqual(calls[0].body, { publicKey: WALLET, action: "sell", mint: MINT, amount: 1.5, denominatedInSol: "false", slippage: 1, priorityFee: 0.0001, pool: "pump" });
  assert.equal((calls[1].body as { amount: string }).amount, "100%");
});

test("collectCreatorFee and create request shapes", async () => {
  const { pp, calls } = setup();
  const mint = Keypair.generate().publicKey.toBase58();
  await pp.buildCollectFeeTx({ wallet: WALLET });
  await pp.buildCreateTx({ creator: WALLET, mint, name: "Agent", symbol: "AGT", metadataUri: `https://ipfs.io/ipfs/${CID}`, devBuyLamports: BigInt(500_000_000), slippageBps: 1000 });
  assert.deepEqual(calls[0].body, { publicKey: WALLET, action: "collectCreatorFee", priorityFee: 0.0001 });
  assert.deepEqual(calls[1].body, {
    publicKey: WALLET,
    action: "create",
    tokenMetadata: { name: "Agent", symbol: "AGT", uri: `https://ipfs.io/ipfs/${CID}` },
    mint,
    denominatedInSol: "true",
    amount: 0.5,
    slippage: 10,
    priorityFee: 0.0001,
    pool: "pump",
  });
});

test("uploadMetadata: image then JSON to Pinata (public network, bearer JWT)", async () => {
  const { pp, calls } = setup();
  const out = await pp.uploadMetadata({ name: "Agent", symbol: "AGT", description: "an agent", imageDataUrl: PNG, website: "https://snipad.fun" });
  assert.deepEqual(out, { metadataUri: `https://ipfs.io/ipfs/${CID}`, imageUri: `https://ipfs.io/ipfs/${CID}` });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.url, "https://uploads.pinata.cloud/v3/files");
    assert.equal((c.init.headers as Record<string, string>).authorization, "Bearer jwt-secret");
    assert.equal((c.body as FormData).get("network"), "public");
  }
  const img = (calls[0].body as FormData).get("file") as File;
  assert.equal(img.type, "image/png");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "png-bytes");
  const meta = JSON.parse(await ((calls[1].body as FormData).get("file") as File).text());
  assert.deepEqual(meta, { name: "Agent", symbol: "AGT", description: "an agent", image: `https://ipfs.io/ipfs/${CID}`, showName: true, website: "https://snipad.fun" });
});

test("validation and provider errors", async () => {
  const { pp } = setup();
  await assert.rejects(pp.uploadMetadata({ name: "A", symbol: "AGT", description: "", imageDataUrl: "data:text/html;base64,PGI+" }), /png\/jpeg\/gif\/webp/);
  await assert.rejects(pp.uploadMetadata({ name: "x".repeat(33), symbol: "AGT", description: "", imageDataUrl: PNG }), /name/);
  await assert.rejects(pp.buildTradeTx({ wallet: WALLET, mint: "bad", side: "buy", amount: BigInt(1), decimals: 9, slippageBps: 100 }), /mint is not a base58/);
  await assert.rejects(pp.buildTradeTx({ wallet: WALLET, mint: MINT, side: "buy", amount: BigInt(0), decimals: 9, slippageBps: 100 }), /positive bigint/);
  const bad = setup((url) => (url.includes("pinata") ? json({ error: "jwt-secret invalid" }, 401) : new Response("Bad Request", { status: 400 })));
  await assert.rejects(bad.pp.buildCollectFeeTx({ wallet: WALLET }), (e: Error & { status: number; notLanded: boolean }) => e.status === 400 && e.notLanded && /^pumpportal: collectCreatorFee -> 400/.test(e.message));
  await assert.rejects(bad.pp.uploadMetadata({ name: "A", symbol: "AGT", description: "", imageDataUrl: PNG }), (e: Error) => /^pinata: upload -> 401/.test(e.message) && !e.message.includes("jwt-secret"));
});
