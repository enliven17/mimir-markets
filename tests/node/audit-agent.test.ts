import assert from "node:assert/strict";
import test from "node:test";
import { auditAction, proposalKey, processAuditProposal, reviewProposal, auditQueue, isAuditReceiptJob, type AuditProposal, type AuditJob, type AuditIO } from "../../agents/audit/review";
import { auditDisputeCall, loadAuditProposal, auditIO } from "../../agents/audit/chain";
import { marketChains } from "../../lib/chains/registry";
import { decodeFunctionData, parseAbi, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { spawnSync } from "node:child_process";

test("standalone auditor prints reviewed owner setup transactions without broadcasting", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "agents/audit/run.ts", "--print-setup"], { cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test", AUDIT_AGENT_ADDRESS: "0x00000000000000000000000000000000000000a1", MARKET_CHAINS: "base", BASE_NETWORK: "sepolia", MIMIR_BASE_V3_ADDRESS: "0x0000000000000000000000000000000000000001", MIMIR_BASE_POOL_ADDRESS: "0x0000000000000000000000000000000000000002", MIMIR_BASE_FROM_BLOCK: "10" } });
  assert.equal(result.status, 0, result.stderr);
  const setup = JSON.parse(result.stdout);
  assert.equal(setup.broadcast, false);assert.equal(setup.calls.length, 2);
  for (const call of setup.calls) {
    assert.equal(call.value, "0");
    const decoded = decodeFunctionData({ abi: parseAbi(["function setAuditAgent(address)"]), data: call.data });
    assert.equal(decoded.args?.[0].toLowerCase(), "0x00000000000000000000000000000000000000a1");
  }
});

const account = "0x00000000000000000000000000000000000000a1" as const;
const other = "0x00000000000000000000000000000000000000b0" as const;
const hash = `0x${"1".repeat(64)}` as const;
const proposal: AuditProposal = { chainId: 84532, contract: other, kind: "vs", marketId: "7", proposedAt: 100, disputableUntil: 3700, now: 200, live: true, side: 1, evidenceHash: hash, question: "Will the combined score exceed 250?", labelA: "Yes", labelB: "No", resolutionUrl: "https://example.com/game#mimir=json:eq:true:finished", category: "sports", deadline: 99, createdAt: 1, summary: "Original proposal" };
const review = { side: 2 as const, confidence: 95, explanation: "120 + 115 = 235.", model: "audit/test", evidence: { url: "https://example.com/game", text: "Final: 120–115", fetcher: "direct" }, reviewedAt: 200 };

test("audit transactions use only existing dispute selectors with the exact native/ERC20 bond", () => {
  const chains = marketChains({ arc: { mimirV3: account, mimirPool: other }, base: { mimirV3: account, mimirPool: other } }).chains;
  const abi = parseAbi(["function disputeResolution(uint256)", "function dispute(uint256)"]);
  for (const cfg of [chains.arc, chains.base]) for (const kind of ["vs", "pool"] as const) {
    const call = auditDisputeCall(cfg, kind, "7");
    assert.equal(call.to, kind === "vs" ? account : other);
    assert.equal(call.value ?? 0n, cfg.id === "arc" ? 2_000_000_000_000_000_000n : 0n);
    const decoded = decodeFunctionData({ abi, data: call.data });
    assert.equal(decoded.functionName, kind === "vs" ? "disputeResolution" : "dispute");
    assert.deepEqual(decoded.args, [7n]);
  }
});

test("proposal reads are authoritative and bind the configured chain, contract and deadline", async () => {
  const cfg = marketChains({ arc: {}, base: { mimirV3: account, mimirPool: other } }).chains.base;
  const reads: string[] = [];
  const client = { getChainId: async () => cfg.chainId, getBlock: async () => ({ timestamp: 200n }), readContract: async (r: any) => {
    reads.push(r.functionName);assert.equal(r.address, account);assert.deepEqual(r.args ?? [], r.functionName === "disputeWindow" ? [] : [7n]);
    if (r.functionName === "getClaim") return [other, proposal.question, "Yes", "No", proposal.resolutionUrl, 10n, 10n, 0n, 99n, 4, 0, "", 0, "sports", 0n, 1n, 1n, hash];
    if (r.functionName === "proposals") return [1, 95, 100n, 0n, other, 0n, hash, "proposal"];
    if (r.functionName === "disputeWindow") return 3600n;
    throw Error("unexpected read");
  } } as unknown as PublicClient;
  const p = await loadAuditProposal(cfg, client, "vs", "7");
  assert.equal(p.disputableUntil, 3700);assert.equal(p.live, true);assert.equal(p.question, proposal.question);assert.equal(p.contract, account);assert.equal(p.now, 200);
  assert.deepEqual(reads.sort(), ["disputeWindow", "getClaim", "proposals"].sort());
  await assert.rejects(loadAuditProposal(cfg, { ...client, getChainId: async () => 1 } as PublicClient, "vs", "7"), /chain/i);
});

function fixture(mode: "observe" | "challenge" = "challenge") {
  let current = { ...proposal };
  let roles = { auditAgent: account as string, owner: other as string, arbiter: other as string, oracle: other as string, feeRecipient: other as string };
  const calls = { reviews: 0, bonds: 0, sends: 0, saves: 0, receipts: 0 };
  const job: AuditJob = { proposal: { ...proposal }, status: "pending" };
  const io: AuditIO = { account, mode, load: async () => ({ ...current }), roles: async () => ({ ...roles }), review: async () => { calls.reviews++;return { ...review }; }, prepareBond: async () => { calls.bonds++; }, submit: async () => { calls.sends++;return hash; }, receipt: async () => { calls.receipts++;return null; }, save: async () => { calls.saves++; } };
  return { job, io, calls, mutate: (p: Partial<AuditProposal>) => { current = { ...current, ...p }; }, roles: (r: Partial<typeof roles>) => { roles = { ...roles, ...r }; } };
}

test("audit identities bind the actual deployment and exact proposal", () => {
  for (const change of [{ chainId: 5042002 }, { contract: account }, { kind: "pool" as const }, { marketId: "8" }, { proposedAt: 101 }, { side: 2 as const }, { evidenceHash: `0x${"2".repeat(64)}` as const }, { question: "A different question after a reorg?" }, { labelA: "No" }, { resolutionUrl: "https://example.com/other" }]) assert.notEqual(proposalKey(proposal), proposalKey({ ...proposal, ...change }));
  assert.equal(proposalKey(proposal), proposalKey({ ...proposal, now: 300 }));
});

test("only firm evidence-backed disagreement requests a dispute", () => {
  assert.equal(auditAction(proposal, review), "challenge");
  assert.equal(auditAction(proposal, { ...review, side: 1 }), "agree");
  for (const confidence of [0, 89, NaN, Infinity, 101]) assert.equal(auditAction(proposal, { ...review, confidence }), "retry");
  assert.equal(auditAction(proposal, { ...review, side: 4 }), "retry");
  assert.equal(auditAction(proposal, { ...review, evidence: { ...review.evidence, text: "" } }), "retry");
});

test("audit evaluation fetches the original source and uses only the audit LLM scope", async () => {
  let asked = ""; let fetched = "";
  const result = await reviewProposal(proposal, {
    fetch: async url => { fetched = url;return { text: "Final score: 120–115", fetcher: "direct", url }; },
    llm: async (prompt, opts) => { asked = prompt;assert.equal(opts.role, "audit");assert.equal(opts.settlement, true);assert.equal(opts.noFreeRouter, true);return { text: JSON.stringify({ verdict: "CHALLENGERS_WIN", confidence: 96, explanation: "The final score is 235." }), provider: "fixture", model: "independent" }; },
  });
  assert.equal(fetched, "https://example.com/game");
  assert.match(asked, /Will the combined score exceed 250\?/);
  assert.doesNotMatch(asked, /#mimir|Original proposal|json:eq:true/);
  assert.equal(result?.side, 2);
  assert.equal(result?.model, "fixture/independent");
});

test("missing evidence or invalid model output causes retry without a guessed objection", async () => {
  const llm = async () => { throw Error("must not ask a model without evidence"); };
  assert.equal(await reviewProposal(proposal, { fetch: async () => { throw Error("source unavailable"); }, llm }), null);
  for (const text of ["not JSON", '{"verdict":"CHALLENGERS_WIN","confidence":"95","explanation":"x"}', '{"verdict":"CHALLENGERS_WIN","confidence":200,"explanation":"x"}']) {
    assert.equal(await reviewProposal(proposal, { fetch: async () => ({ url: "https://example.com/game", text: "Final score 235", fetcher: "direct" }), llm: async () => ({ text, provider: "fixture", model: "x" }) }), null);
  }
});

test("agreement and observation mode never approve or spend a bond", async () => {
  const agreed = fixture();agreed.io.review = async () => ({ ...review, side: 1 });
  await processAuditProposal(agreed.job, agreed.io);
  assert.equal(agreed.job.status, "agreed");assert.equal(agreed.calls.sends, 0);assert.equal(agreed.calls.bonds, 0);
  const observed = fixture("observe");await processAuditProposal(observed.job, observed.io);
  assert.equal(observed.job.status, "observed");assert.equal(observed.calls.sends, 0);assert.equal(observed.calls.bonds, 0);
});

test("confirmed registration is required before an audit can spend", async () => {
  for (const change of [{ auditAgent: other }, { oracle: account }, { owner: account }, { arbiter: account }, { feeRecipient: account }]) {
    const f = fixture();f.roles(change);
    await assert.rejects(processAuditProposal(f.job, f.io), /audit|role|separate/i);
    assert.equal(f.calls.sends, 0);assert.equal(f.calls.bonds, 0);
  }
});

test("a valid objection is saved and submitted once; an unknown receipt never resubmits", async () => {
  const f = fixture();await processAuditProposal(f.job, f.io);
  assert.equal(f.job.status, "submitted");assert.equal(f.job.txHash, hash);assert.equal(f.calls.sends, 1);assert.ok(f.calls.saves >= 2);
  await processAuditProposal(f.job, f.io);
  assert.equal(f.calls.sends, 1);assert.equal(f.calls.reviews, 1);
  f.io.receipt = async () => "success";await processAuditProposal(f.job, f.io);
  assert.equal(f.job.status, "challenged");assert.equal(f.calls.sends, 1);
});

test("a mined dispute remains monitored and reopens only after its receipt disappears and the proposal is live", async () => {
  const f = fixture();await processAuditProposal(f.job, f.io);
  f.io.receipt = async () => "success";await processAuditProposal(f.job, f.io);
  assert.equal(f.job.status, "challenged");
  f.mutate({ live: false });f.io.receipt = async () => null;
  await processAuditProposal(f.job, f.io);
  assert.equal(f.job.status, "challenged");assert.equal(f.calls.sends, 1);
  f.mutate({ live: true });await processAuditProposal(f.job, f.io);
  assert.equal(f.job.status, "pending");assert.equal(f.job.txHash, undefined);
  await processAuditProposal(f.job, f.io);
  assert.equal(f.calls.sends, 2);
});

test("receipt scheduling retains mined disputes and rotates older due jobs fairly", () => {
  const mined: AuditJob = { proposal, status: "challenged", txHash: hash, nextTry: 100 };
  const waiting: AuditJob = { proposal: { ...proposal, marketId: "8" }, status: "submitted", txHash: hash, nextTry: 90 };
  assert.deepEqual(auditQueue([mined, waiting], "challenge", 200).filter(isAuditReceiptJob), [waiting, mined]);
  assert.equal(auditQueue([{ ...mined, nextTry: 300 }], "challenge", 200).length, 0);
});

test("the receipt adapter rejects inclusion in an orphaned block", async () => {
  const cfg = marketChains({ arc: { mimirV3: account, mimirPool: other }, base: {} }).chains.arc;
  const pub = { getTransactionReceipt: async () => ({ status: "success", blockNumber: 1n, blockHash: hash }), getBlock: async () => ({ hash: `0x${"2".repeat(64)}` }) } as unknown as PublicClient;
  const io = auditIO(cfg, pub, undefined, undefined, "observe", { proposal, status: "challenged", txHash: hash }, async () => {});
  assert.equal(await io.receipt(hash), null);
});

test("a changed proposal, expired window or role revocation aborts before sending", async () => {
  for (const phase of ["evaluation", "bond"]) for (const change of [{ side: 2 as const }, { now: 3700 }, { live: false }]) {
    const f = fixture();
    if (phase === "evaluation") f.io.review = async () => { f.mutate(change);return { ...review }; };
    else f.io.prepareBond = async () => { f.mutate(change); };
    await processAuditProposal(f.job, f.io);assert.equal(f.calls.sends, 0);
  }
  const f = fixture();f.io.prepareBond = async () => { f.roles({ auditAgent: other }); };
  await assert.rejects(processAuditProposal(f.job, f.io), /audit|role/i);assert.equal(f.calls.sends, 0);
});

test("temporary evaluation failure leaves a retryable pending proposal", async () => {
  const f = fixture();f.io.review = async () => null;
  await processAuditProposal(f.job, f.io);assert.equal(f.job.status, "pending");assert.equal(f.calls.sends, 0);
});

test("an unknown bond-approval transaction is reconciled before any further audit action", async () => {
  const f = fixture();f.job.approvalTxHash = hash;
  await processAuditProposal(f.job, f.io);
  assert.equal(f.calls.reviews, 0);assert.equal(f.calls.bonds, 0);assert.equal(f.calls.sends, 0);
  f.io.receipt = async () => "success";
  await processAuditProposal(f.job, f.io);
  assert.equal(f.job.approvalTxHash, undefined);assert.equal(f.calls.sends, 1);
});

test("audit transaction signing retains the local account instead of switching to RPC wallet signing", async () => {
  const signer = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const cfg = marketChains({ arc: { mimirV3: account, mimirPool: other }, base: {} }).chains.arc;
  const wallet = { account: signer, chain: undefined, sendTransaction: async (args: any) => { assert.equal(args.account, signer);return hash; } } as unknown as WalletClient;
  const pub = { call: async () => ({ data: "0x" }) } as unknown as PublicClient;
  const job: AuditJob = { proposal: { ...proposal, chainId: cfg.chainId, contract: account }, status: "pending" };
  const io = auditIO(cfg, pub, wallet, signer.address, "challenge", job, async () => {});
  assert.equal(await io.submit(), hash);
});
