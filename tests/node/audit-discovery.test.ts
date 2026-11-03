import assert from "node:assert/strict";
import test from "node:test";
import { discoverAuditJobs } from "../../agents/audit/discover";
import { marketChains } from "../../lib/chains/registry";
import type { AuditState } from "../../agents/audit/state";
import type { AuditProposal } from "../../agents/audit/review";
import type { PublicClient } from "viem";

const contract = "0x0000000000000000000000000000000000000001" as const;
const hash = `0x${"1".repeat(64)}` as const;
const cfg = marketChains({ arc: {}, base: { mimirV3: contract, mimirPool: contract, fromBlock: "10" } }).chains.base;
const fresh = (): AuditState => ({ version: 1, deployment: "fixture", cursors: {}, seen: {}, jobs: {} });
const p: AuditProposal = { chainId: cfg.chainId, contract, kind: "vs", marketId: "7", proposedAt: 100, disputableUntil: 3700, now: 200, live: true, side: 1, evidenceHash: hash, question: "Question?", labelA: "Yes", labelB: "No", resolutionUrl: "https://example.com", category: "custom", deadline: 99, createdAt: 1, summary: "proposal" };
function client() {
  return { getChainId: async () => cfg.chainId, getBlock: async () => ({ number: 30n, timestamp: 200n }), getContractEvents: async (r: any) => {
    assert.equal(r.address, contract);assert.ok(r.fromBlock >= 10n);assert.ok(r.toBlock <= 30n);
    return [{ args: { id: 7n, disputableUntil: 3700n }, blockHash: hash, transactionHash: hash, blockNumber: 20n, logIndex: r.abi === undefined ? 1 : 0 }];
  } } as unknown as PublicClient;
}
test("discovery checkpoints live proposals and tolerates replay without duplicate reviews", async () => {
  const state = fresh();let loads = 0;
  const load = async (_cfg: any, _pub: any, kind: "vs" | "pool") => { loads++;return { ...p, kind }; };
  await discoverAuditJobs(cfg, client(), state, load);
  assert.equal(Object.keys(state.jobs).length, 2);
  await discoverAuditJobs(cfg, client(), state, load);
  assert.equal(loads, 2);assert.equal(Object.keys(state.jobs).length, 2);
  assert.ok(Object.values(state.cursors).every(v => v === "31"));
});
test("failed discovery does not advance its cursor past an unseen proposal", async () => {
  const state = fresh();
  await assert.rejects(discoverAuditJobs(cfg, client(), state, async () => { throw Error("RPC failed"); }), /RPC failed/);
  assert.equal(Object.keys(state.cursors).length, 0);assert.equal(Object.keys(state.jobs).length, 0);
});
