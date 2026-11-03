/** Local Anvil only: real contracts/RPC/signing; evidence and model replies are fixtures. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { marketChains } from "../../lib/chains/registry.ts";
import { auditIO } from "../../agents/audit/chain.ts";
import { discoverAuditJobs } from "../../agents/audit/discover.ts";
import { processAuditProposal, reviewProposal } from "../../agents/audit/review.ts";
import { readAuditState, saveAuditState } from "../../agents/audit/state.ts";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const artifact = async name => JSON.parse(await readFile(new URL(`../../forge-out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
const accounts = Array.from({ length: 7 }, (_, i) => privateKeyToAccount(`0x${BigInt(i + 1).toString(16).padStart(64, "0")}`));
const [owner, arbiter, oracle, treasury, auditor, creator, bettor] = accounts;

async function exercise(id, native) {
  const server = createServer();await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;await new Promise(r => server.close(r));
  const child = spawn(process.env.ANVIL_BINARY || "anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(id), "--silent"], { stdio: "ignore" });
  const exited = new Promise(r => { child.once("exit", r);child.once("error", r); });
  const root = await mkdtemp(join(tmpdir(), "mimir-audit-integration-"));
  try {
    const chain = defineChain({ id, name: "Local auditor integration", nativeCurrency: { name: native ? "USDC" : "Ether", symbol: native ? "USDC" : "ETH", decimals: 18 }, rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } } });
    const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 0 }), pollingInterval: 20 });
    let ready = false;
    for (let i = 0; i < 40; i++) { try { ready = await pub.getChainId() === id;if (ready) break; } catch {} await sleep(100); }
    assert.ok(ready, "local Anvil did not start");
    for (const a of accounts) await pub.request({ method: "anvil_setBalance", params: [a.address, `0x${(1000n * 10n ** 18n).toString(16)}`] });
    const wallet = a => createWalletClient({ account: a, chain, transport: http() });
    const wait = async hash => { const r = await pub.waitForTransactionReceipt({ hash });assert.equal(r.status, "success");return r; };
    const write = async (who, contract, functionName, args, value = 0n) => wait(await wallet(who).writeContract({ address: contract.address, abi: contract.abi, functionName, args, value }));
    const read = (contract, functionName, args = []) => pub.readContract({ address: contract.address, abi: contract.abi, functionName, args });
    const deploy = async (name, args) => {
      const a = await artifact(name);const r = await wait(await wallet(owner).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }));
      assert.ok(r.contractAddress);return { address: r.contractAddress, abi: a.abi, block: r.blockNumber };
    };
    const fee = await deploy("FlatFees", [0]);
    const token = native ? null : await deploy("MockUsdc", []);
    const unit = native ? 10n ** 18n : 10n ** 6n;
    const baseArgs = [owner.address, arbiter.address, oracle.address, treasury.address, fee.address, 3600n, unit / 10n];
    const vs = await deploy(native ? "MimirV3" : "MimirV3Erc20", native ? baseArgs : [...baseArgs, token.address]);
    const pool = await deploy(native ? "MimirPool" : "MimirPoolErc20", native ? baseArgs : [...baseArgs, token.address]);
    const source = "https://example.com/game#mimir=json:eq:true:finished";
    for (const c of [vs, pool]) await write(owner, c, "setAuditAgent", [auditor.address]);
    if (token) {
      for (const a of [auditor, creator, bettor]) await write(owner, token, "mint", [a.address, 100n * unit]);
      for (const a of [creator, bettor]) for (const c of [vs, pool]) await write(a, token, "approve", [c.address, 100n * unit]);
    }
    const deadline = Number((await pub.getBlock()).timestamp) + 3600;
    const question = "Will the combined score exceed 250?";
    await write(creator, vs, "createClaim", [question, "Yes", "No", source, BigInt(deadline), 10n * unit, "sports", 0n, "binary", "pool", 0n, "", "", 100n, true, "", zeroAddress], native ? 10n * unit : 0n);
    await write(creator, vs, "setInvited", [1n, [bettor.address], true]);
    await write(bettor, vs, "challengeClaim", [1n, 10n * unit, "", zeroAddress], native ? 10n * unit : 0n);
    await write(creator, pool, "createMarket", [question, "Yes", "No", source, "sports", BigInt(deadline), 1, zeroAddress, ...(!native ? [10n * unit] : [])], native ? 10n * unit : 0n);
    await write(bettor, pool, "stake", [1n, 2, zeroAddress, ...(!native ? [10n * unit] : [])], native ? 10n * unit : 0n);
    await pub.request({ method: "evm_setNextBlockTimestamp", params: [deadline + 1] });await pub.request({ method: "evm_mine", params: [] });
    await write(oracle, vs, "resolveClaim", [1n, 1, "wrong Yes proposal", 95, `0x${"0".repeat(64)}`]);
    await write(oracle, pool, "resolve", [1n, 1, "wrong Yes proposal", `0x${"0".repeat(64)}`]);
    const cfg = marketChains({ arc: { mimirV3: vs.address, mimirPool: pool.address }, base: { mimirV3: vs.address, mimirPool: pool.address, usdc: token?.address } }).chains[native ? "arc" : "base"];
    cfg.contracts.fromBlock = vs.block;
    const statePath = join(root, "state.json");const state = await readAuditState(statePath, `fixture:${id}`);
    await discoverAuditJobs(cfg, pub, state);assert.equal(Object.keys(state.jobs).length, 2);
    const save = async () => saveAuditState(statePath, state);
    for (const job of Object.values(state.jobs)) {
      const contract = job.proposal.kind === "vs" ? vs : pool;
      const io = auditIO(cfg, pub, wallet(auditor), auditor.address, "observe", job, save);
      io.review = p => reviewProposal(p, { fetch: async () => ({ text: "Final: Team A 120, Team B 115. Combined score 235.", fetcher: "fixture", url: "https://example.com/game" }), llm: async () => ({ text: JSON.stringify({ verdict: "CHALLENGERS_WIN", confidence: 96, explanation: "235 is below 250." }), provider: "fixture", model: "independent" }) });
      const beforeNonce = await pub.getTransactionCount({ address: auditor.address });
      await processAuditProposal(job, io);assert.equal(job.status, "observed");
      assert.equal(await pub.getTransactionCount({ address: auditor.address }), beforeNonce, "observe mode signed a transaction");
      const before = token ? await read(token, "balanceOf", [auditor.address]) : await pub.getBalance({ address: auditor.address });
      io.mode = "challenge";
      try { await processAuditProposal(job, io); } catch (err) { assert.match(err.message, /approval submitted/); }
      if (job.approvalTxHash) { await wait(job.approvalTxHash);await processAuditProposal(job, io); }
      assert.equal(job.status, "submitted");const sent = job.txHash;const rc = await wait(sent);
      await processAuditProposal(job, io);assert.equal(job.status, "challenged");
      await processAuditProposal(job, io);assert.equal(job.txHash, sent);
      const p = await read(contract, job.proposal.kind === "vs" ? "proposals" : "getProposal", [1n]);
      assert.equal(p[job.proposal.kind === "vs" ? 4 : 3], auditor.address);
      if (job.proposal.kind === "vs") {
        assert.equal(await read(vs, "hasChallenged", [1n, auditor.address]), false);
        assert.equal(await read(vs, "invited", [1n, auditor.address]), false);
        await write(arbiter, vs, "resolveDispute", [1n, 2, "correct No outcome", 96, `0x${"2".repeat(64)}`]);
      } else await write(arbiter, pool, "resolveDispute", [1n, 2, "correct No outcome", `0x${"2".repeat(64)}`]);
      const after = token ? await read(token, "balanceOf", [auditor.address]) : await pub.getBalance({ address: auditor.address });
      assert.equal(after, token ? before : before - rc.gasUsed * rc.effectiveGasPrice, "correct dispute did not recover its bond");
      console.log(`PASS local ${native ? "native" : "ERC20"} ${job.proposal.kind}: observe sends nothing; independent unstaked auditor challenges; arbiter corrects and bond returns`);
    }
    const restored = await readAuditState(statePath, `fixture:${id}`);
    assert.ok(Object.values(restored.jobs).every(j => j.txHash && j.status === "challenged"));
    console.log(`PASS local chain ${id}: confirmed transaction state survives checkpoint reload`);
  } finally { child.kill("SIGTERM");await exited;await rm(root, { recursive: true, force: true }); }
}
await exercise(5042002, true);
await exercise(84532, false);
