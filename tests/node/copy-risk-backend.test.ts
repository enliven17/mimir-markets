import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { memoryBackend } from "../helpers/convex-memory";
import * as risk from "../../convex/copyRisk";
import * as copy from "../../convex/launchCopy";
import * as discovery from "../../convex/discovery";
import * as launch from "../../convex/launch";
import * as opinions from "../../convex/councilOpinions";
import { DEFAULT_COPY_RISK } from "../../lib/launch/copy-risk";
const secret = "risk-test-secret-123456789";
let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { ...process.env }; process.env.MIMIR_LAUNCH_SECRET = secret; });
afterEach(() => { process.env = env; });
test("forecast-only updates have a fixed creator budget and never touch stake decisions", async () => {
  const b = memoryBackend(); delete process.env.ARC_CREATOR_WALLET; delete process.env.COUNCIL_TAKES_PER_CREATOR_DAY;
  for (let i = 0; i < 3; i++) assert.equal(await b.run(opinions.claim, { creator: "creator" }), true);
  assert.equal(await b.run(opinions.claim, { creator: "creator" }), false);
  await b.db.insert("arcMarkets", { kind: "pool", marketId: 1, isPrivate: false, category: "crypto", labelA: "Yes", labelB: "No", question: "A public question" });
  const forecast = { kind: "pool", marketId: 1, slug: "socrates", lean: 1, confidence: 65, text: "A forecast", evidenceHash: "hash-one" };
  await b.run(opinions.record, forecast); await b.run(opinions.record, forecast);
  assert.equal((await b.db.query("discoverySignals").collect()).length, 1);
  await b.run(opinions.record, { ...forecast, lean: 2 });
  assert.equal((await b.db.query("discoverySignals").collect())[1].type, "opinion_changed");
  await b.run(opinions.record, { ...forecast, lean: 2, evidenceHash: "hash-two" });
  assert.equal((await b.db.query("discoverySignals").collect())[2].type, "evidence_updated");
  assert.deepEqual(await b.db.query("arcCouncilDecisions").collect(), []);
  assert.deepEqual(await b.db.query("launchStakes").collect(), []);
});
test("atomic reservations prevent another agent spending the same follower's remaining token budget", async () => {
  const b = memoryBackend();
  const s1 = await b.db.insert("launchCopies", { follower: "A", active: true, solana: { on: true } });
  const s2 = await b.db.insert("launchCopies", { follower: "A", active: true, solana: { on: true } });
  await b.db.insert("launchCopyJobs", { key: "one", sub: s1, status: "running" }); await b.db.insert("launchCopyJobs", { key: "two", sub: s2, status: "running" });
  const quote = { referencePrice: 1, signalAt: Date.now(), price: 1, liquiditySol: 10000, checkedAt: Date.now() };
  assert.equal(await b.run(risk.reserve, { key: "one", sub: s1, mint: "M", lamports: "100000000", quote }), null);
  assert.match(await b.run(risk.reserve, { key: "two", sub: s2, mint: "M", lamports: "100000000", quote }), /token exposure/);
  // Ambiguous sends retain their reservation; proven failure releases it.
  const one = await b.db.query("launchCopyJobs").withIndex("by_key", (q: any) => q.eq("key", "one")).unique();
  await b.db.patch(one._id, { status: "unknown" });
  assert.match(await b.run(risk.reserve, { key: "two", sub: s2, mint: "M", lamports: "100000000", quote }), /token exposure/);
  await b.db.patch(one._id, { status: "failed" });
  assert.equal(await b.run(risk.reserve, { key: "two", sub: s2, mint: "M", lamports: "100000000", quote }), null);
});

test("a leader signal has one liquidity capacity shared across different followers", async () => {
  const b = memoryBackend(); const subs = [];
  for (const follower of ["A", "B"]) {
    const sub = await b.db.insert("launchCopies", { follower, active: true, solana: { on: true } }); subs.push(sub);
    await b.db.insert("copyRiskPolicies", { follower, policy: { ...DEFAULT_COPY_RISK, maxLiquidityBps: 100 } });
    await b.db.insert("launchCopyJobs", { key: `${sub}:buy:SIGNAL`, sub, status: "running" });
  }
  const quote = { referencePrice: 1, signalAt: Date.now(), price: 1, liquiditySol: 10, checkedAt: Date.now() };
  assert.equal(await b.run(risk.reserve, { key: `${subs[0]}:buy:SIGNAL`, sub: subs[0], mint: "M", lamports: "50000000", quote }), null);
  assert.match(await b.run(risk.reserve, { key: `${subs[1]}:buy:SIGNAL`, sub: subs[1], mint: "M", lamports: "50000000", quote }), /shared copy liquidity capacity/);
});
test("partial copy exits record actual proceeds once, preserve remaining cost, and update loss guards", async () => {
  const b = memoryBackend(); const sub = await b.db.insert("launchCopies", { follower: "A" });
  await b.db.insert("launchCopyPositions", { sub, mint: "M", tokens: "100", costLamports: "1000" });
  const args = { sub, mint: "M", held: "100", left: "50", receipt: { sig: "SELL", proceeds: "300" } };
  await b.run(copy.settleSell, args); await b.run(copy.settleSell, args);
  const row = await b.db.query("launchCopyPositions").first(); assert.equal(row.tokens, "50"); assert.equal(row.costLamports, "500");
  const ledger = await b.db.query("copyRiskLedgers").first(); assert.equal(ledger.pnl, "-200"); assert.equal(ledger.dailyPnl, "-200");
  assert.equal((await b.db.query("copyExecutionReceipts").collect()).length, 1);
});
test("watchlists require the server secret, isolate owners and hide private market signals", async () => {
  const b = memoryBackend();
  await assert.rejects(b.run(discovery.setFollow, { secret: "wrong", owner: "A", target: "topic:crypto", active: true }), /not allowed/);
  await b.run(discovery.setFollow, { secret, owner: "A", target: "topic:crypto", active: true });
  const at = Date.now() + 1;
  await b.db.insert("arcMarkets", { kind: "pool", marketId: 1, isPrivate: true });
  await b.db.insert("discoverySignals", { marketKind: "pool", marketId: 1, category: "crypto", text: "private", at });
  assert.deepEqual((await b.run(discovery.inbox, { secret, owner: "A" })).items, []);
  assert.deepEqual((await b.run(discovery.inbox, { secret, owner: "B" })).follows, []);
});
test("public market evidence never exposes private questions", async () => {
  const b = memoryBackend(), address = "0x" + "a".repeat(40);
  await b.db.insert("arcPositions", { user: address, kind: "pool", marketId: 1, amount: "1", side: 1 });
  await b.db.insert("arcMarkets", { kind: "pool", marketId: 1, question: "private", isPrivate: true });
  assert.deepEqual((await b.run(launch.publicMarketRecord, { address })).records, []);
});
