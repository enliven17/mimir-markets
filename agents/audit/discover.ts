import type { PublicClient } from "viem";
import type { MarketChain } from "../../lib/chains/registry";
import { V3_ABI, POOL_ABI } from "../../lib/chains/indexer";
import { loadAuditProposal } from "./chain";
import { proposalKey } from "./review";
import type { AuditState } from "./state";

/** Durable, bounded log discovery. Rescan a 64-block overlap for ordinary shallow reorgs. */
export async function discoverAuditJobs(cfg: MarketChain, pub: PublicClient, state: AuditState, load = loadAuditProposal): Promise<void> {
  if (await pub.getChainId() !== cfg.chainId) throw Error("Audit RPC chain mismatch");
  const head = await pub.getBlock();const now = Number(head.timestamp);
  if (head.number === null) throw Error("Audit head is not mined");
  for (const [key, until] of Object.entries(state.seen)) if (until < now) delete state.seen[key];
  // Reports are archived separately by the runner; don't retain completed transaction jobs forever.
  for (const [key, job] of Object.entries(state.jobs)) if (job.proposal.disputableUntil < now && !job.approvalTxHash && (!job.txHash || job.status === "challenged")) delete state.jobs[key];
  for (const kind of ["vs", "pool"] as const) {
    const address = kind === "vs" ? cfg.contracts.mimirV3 : cfg.contracts.mimirPool;
    if (!address) continue;
    const domain = `${cfg.chainId}:${address.toLowerCase()}:${kind}`;
    const next = BigInt(state.cursors[domain] ?? cfg.contracts.fromBlock.toString());
    const overlap = next > 64n ? next - 64n : 0n;
    const fromBlock = overlap > cfg.contracts.fromBlock ? overlap : cfg.contracts.fromBlock;
    if (fromBlock > head.number) throw Error("Audit checkpoint is ahead of this chain; verify RPC/reorg before resuming");
    // Same spans as the indexer (convex/arcSync.ts CHUNK): public Base RPCs cap eth_getLogs at 200 blocks.
    const span = cfg.id === "base" ? 199n : 249n;
    const toBlock = fromBlock + span < head.number ? fromBlock + span : head.number;
    const logs = await pub.getContractEvents({ address, abi: kind === "vs" ? V3_ABI : POOL_ABI, eventName: "ResolutionProposed", fromBlock, toBlock });
    for (const log of logs) {
      if (!log.blockHash || log.logIndex === null || log.args.id === undefined || log.args.disputableUntil === undefined) throw Error("Incomplete audit proposal log");
      const event = `${domain}:${log.blockHash}:${log.logIndex}`;
      const until = Number(log.args.disputableUntil);
      if (!Number.isSafeInteger(until)) throw Error("Invalid audit proposal deadline");
      if (state.seen[event] || until <= now) continue;
      if (Object.keys(state.jobs).length >= 1000 || Object.keys(state.seen).length >= 10_000) throw Error("Audit queue capacity reached; cursor not advanced, operator attention required");
      const proposal = await load(cfg, pub, kind, log.args.id.toString());
      const key = proposalKey(proposal);
      if (proposal.live && proposal.disputableUntil > proposal.now && !state.jobs[key]) state.jobs[key] = { proposal, status: "pending" };
      state.seen[event] = until;
    }
    state.cursors[domain] = (toBlock + 1n).toString();
  }
}
