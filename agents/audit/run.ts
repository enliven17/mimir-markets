/** Run separately with audit credentials only. Never imports the proposer worker or its verdict cache. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { writeFile, mkdir, rename } from "node:fs/promises";
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { serverMarketChains, type MarketChain } from "../../lib/chains/registry";
import { chainTransport, viemChainOf } from "../../lib/chains/client";
import { providerChain } from "../../lib/llm";
import { AUDIT_ROLE_ABI, auditIO, readAuditRoles } from "./chain";
import { assertAuditRoles, processAuditProposal, proposalKey, auditQueue, isAuditReceiptJob, type AuditJob } from "./review";
import { discoverAuditJobs } from "./discover";
import { lockAuditState, readAuditState, saveAuditState } from "./state";
import { auditOpenAIConfig } from "./openai-compat";

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Audit worker: node --env-file=.env.audit --import tsx agents/audit/run.ts [--once|--print-setup]. AUDIT_MODE=observe (default) or challenge; AUDIT_STATE_FILE required. See docs/releases/audit-agent-2026-11-04.md.");return;
  }
  const registry = serverMarketChains(process.env);
  const configs = registry.enabled.map(id => registry.chains[id]);
  if (!configs.length) throw Error("No audit market deployment configured");
  const key = process.env.AUDIT_AGENT_KEY?.trim();
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw Error("AUDIT_AGENT_KEY must be an EVM private key");
  const account = key ? privateKeyToAccount(key as Hex) : undefined;
  const configured = process.env.AUDIT_AGENT_ADDRESS?.trim();
  const address = configured ? getAddress(configured) : account?.address;
  if (configured && account && getAddress(configured) !== account.address) throw Error("Audit key/address mismatch");
  if (process.argv.includes("--print-setup")) {
    if (!address || address === zeroAddress) throw Error("Configure the public AUDIT_AGENT_ADDRESS");
    console.log(JSON.stringify({ broadcast: false, auditAgent: address, calls: configs.flatMap(cfg => [cfg.contracts.mimirV3!, cfg.contracts.mimirPool!].map(to => ({ chainId: cfg.chainId, to, value: "0", data: encodeFunctionData({ abi: AUDIT_ROLE_ABI, functionName: "setAuditAgent", args: [address] }) }))) }, null, 2));return;
  }
  const mode = process.env.AUDIT_MODE?.trim() || "observe";
  if (mode !== "observe" && mode !== "challenge") throw Error("AUDIT_MODE must be observe or challenge");
  if (mode === "challenge" && !account) throw Error("AUDIT_AGENT_KEY required for challenge mode");
  if (!auditOpenAIConfig() && providerChain({ role: "audit", settlement: true, noFreeRouter: true }).length === 0) throw Error("No dedicated audit model credentials/allowed model; proposer/shared keys are never used");
  const statePath = process.env.AUDIT_STATE_FILE?.trim();
  if (!statePath) throw Error("Set a private AUDIT_STATE_FILE path");
  if (configs.some(c => c.contracts.fromBlock <= 0n)) throw Error("Set each deployment's FROM_BLOCK before running the auditor");
  const path = resolve(statePath);
  const identity = createHash("sha256").update(JSON.stringify({ address: address?.toLowerCase() ?? "observe", deployments: configs.map(c => [c.chainId, c.contracts.mimirV3?.toLowerCase(), c.contracts.mimirPool?.toLowerCase(), c.contracts.fromBlock.toString()]) })).digest("hex");
  const release = await lockAuditState(path);
  try {
    const state = await readAuditState(path, identity);
    const setups = configs.map(cfg => ({ cfg, pub: createPublicClient({ chain: viemChainOf(cfg), transport: chainTransport(cfg) }), wallet: account ? createWalletClient({ account, chain: viemChainOf(cfg), transport: chainTransport(cfg) }) : undefined }));
    for (const s of setups) {
      if (await s.pub.getChainId() !== s.cfg.chainId) throw Error("Audit RPC chain mismatch");
      if (mode === "challenge") for (const contract of [s.cfg.contracts.mimirV3!, s.cfg.contracts.mimirPool!]) {
        assertAuditRoles(account?.address, await readAuditRoles(s.pub, contract));
        if (await s.pub.readContract({ address: contract, abi: AUDIT_ROLE_ABI, functionName: "disputeWindow" }) === 0n) throw Error("A zero-window deployment cannot be protected by a post-proposal auditor");
      }
    }
    const save = async (job?: AuditJob) => {
      if (job?.review) {
        const dir = `${path}.reports`;await mkdir(dir, { recursive: true, mode: 0o700 });
        const name = createHash("sha256").update(proposalKey(job.proposal)).digest("hex");
        const target = `${dir}/${name}.json`, temp = `${target}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(job, null, 2), { mode: 0o600 });await rename(temp, target);
      }
      await saveAuditState(path, state);
    };
    let stop = false;
    const stopping = () => { stop = true; };
    process.once("SIGINT", stopping);process.once("SIGTERM", stopping);
    try {
      do {
        for (const s of setups) {
          try { await discoverAuditJobs(s.cfg, s.pub, state);await save(); }
          catch (err) { console.error(`[audit] ${s.cfg.id} discovery blocked: ${(err as Error).message}`);await save(); }
        }
        const now = Math.floor(Date.now() / 1000);
        const pending = auditQueue(Object.values(state.jobs), mode, now);
        // Receipt polls cannot consume all review slots when an old transaction is stuck.
        const isReceipt = isAuditReceiptJob;
        const batch = [...pending.filter(isReceipt).slice(0, 1), ...pending.filter(j => !isReceipt(j)).slice(0, 2)];
        for (const job of batch) {
          const s = setups.find(s => s.cfg.chainId === job.proposal.chainId && (job.proposal.kind === "vs" ? s.cfg.contracts.mimirV3 : s.cfg.contracts.mimirPool)?.toLowerCase() === job.proposal.contract.toLowerCase());
          if (!s) throw Error("Audit job does not belong to this deployment");
          try {
            const unsettledTransaction = Object.values(state.jobs).some(j => j !== job && j.proposal.chainId === s.cfg.chainId && (j.status === "submitted" || j.approvalTxHash));
            // Continue reviewing while one signer transaction is unresolved, but don't create competing nonce intents.
            const effectiveMode = mode === "challenge" && unsettledTransaction && !job.txHash && !job.approvalTxHash ? "observe" : mode;
            await processAuditProposal(job, auditIO(s.cfg, s.pub, s.wallet, account?.address, effectiveMode, job, async j => save(j)));
            delete job.error;
          } catch (err) { job.error = (err as Error).message.slice(0, 300); }
          job.nextTry = now + (isReceipt(job) ? 15 : job.review ? 60 : 120);
          await save(job);
          console.log(JSON.stringify({ worker: "audit", chainId: job.proposal.chainId, contract: job.proposal.contract, marketId: job.proposal.marketId, status: job.status, txHash: job.txHash, error: job.error }));
        }
        console.log(JSON.stringify({ worker: "audit", heartbeat: new Date().toISOString(), mode, queued: pending.length, processingLimit: 3 }));
        if (stop || process.argv.includes("--once")) break;
        await new Promise(r => setTimeout(r, 15_000));
      } while (!stop);
    } finally { process.removeListener("SIGINT", stopping);process.removeListener("SIGTERM", stopping); }
  } finally { await release(); }
}

main().catch(err => { console.error(`[audit] startup/run failed: ${(err as Error).message}`);process.exitCode = 1; });
