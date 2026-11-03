import { encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { V3_ABI, POOL_ABI } from "../../lib/chains/indexer";
import { ERC20_ABI } from "../../lib/chains/client";
import { marketContract, type MarketChain } from "../../lib/chains/registry";
import { reviewProposal, type AuditIO, type AuditJob, type AuditProposal, type AuditRoles } from "./review";

export const AUDIT_ROLE_ABI = parseAbi([
  "function auditAgent() view returns (address)", "function setAuditAgent(address)",
  "function owner() view returns (address)", "function arbiter() view returns (address)",
  "function oracle() view returns (address)", "function feeRecipient() view returns (address)",
  "function DISPUTE_BOND() view returns (uint256)",
  "function disputeWindow() view returns (uint256)",
]);
const DISPUTE_ABI = parseAbi(["function disputeResolution(uint256) payable", "function dispute(uint256) payable"]);
const idOf = (id: string) => { if (!/^[1-9]\d*$/.test(id)) throw Error("Invalid audit market id");return BigInt(id); };
const contractOf = (cfg: MarketChain, kind: "vs" | "pool") => {
  const contract = marketContract(cfg, kind);if (!contract) throw Error("Audit contract not configured");return contract;
};

export function auditDisputeCall(cfg: MarketChain, kind: "vs" | "pool", marketId: string) {
  return { to: contractOf(cfg, kind), data: encodeFunctionData({ abi: DISPUTE_ABI, functionName: kind === "vs" ? "disputeResolution" : "dispute", args: [idOf(marketId)] }), value: cfg.usdc.kind === "native" ? 2n * 10n ** 18n : 0n };
}

/** Read the proposal and immutable question from the configured contract, not the proposer's DB. */
export async function loadAuditProposal(cfg: MarketChain, pub: PublicClient, kind: "vs" | "pool", marketId: string): Promise<AuditProposal> {
  if (await pub.getChainId() !== cfg.chainId) throw Error("Audit RPC chain does not match configuration");
  const address = contractOf(cfg, kind), args = [idOf(marketId)] as const;
  const [block, window] = await Promise.all([pub.getBlock(), pub.readContract({ address, abi: V3_ABI, functionName: "disputeWindow" })]);
  if (kind === "vs") {
    const [m, p] = await Promise.all([pub.readContract({ address, abi: V3_ABI, functionName: "getClaim", args }), pub.readContract({ address, abi: V3_ABI, functionName: "proposals", args })]);
    return { chainId: cfg.chainId, contract: address, kind, marketId, proposedAt: Number(p[2]), disputableUntil: Number(p[2] + window), now: Number(block.timestamp), live: m[9] === 4, side: p[0], evidenceHash: p[6], question: m[1], labelA: m[2], labelB: m[3], resolutionUrl: m[4], category: m[13], deadline: Number(m[8]), createdAt: Number(m[16]), summary: p[7] };
  }
  const [m, p, text] = await Promise.all([pub.readContract({ address, abi: POOL_ABI, functionName: "getMarket", args }), pub.readContract({ address, abi: POOL_ABI, functionName: "getProposal", args }), pub.readContract({ address, abi: POOL_ABI, functionName: "getMarketText", args })]);
  return { chainId: cfg.chainId, contract: address, kind, marketId, proposedAt: Number(p[1]), disputableUntil: Number(p[1] + window), now: Number(block.timestamp), live: m[3] === 1, side: p[0], evidenceHash: p[5], question: text[0], labelA: text[1], labelB: text[2], resolutionUrl: text[3], category: text[4], deadline: Number(m[1]), createdAt: Number(m[2]), summary: text[5] };
}

export async function readAuditRoles(pub: PublicClient, address: Address): Promise<AuditRoles> {
  const names = ["auditAgent", "owner", "arbiter", "oracle", "feeRecipient"] as const;
  const values = await Promise.all(names.map(functionName => pub.readContract({ address, abi: AUDIT_ROLE_ABI, functionName })));
  return Object.fromEntries(names.map((name, i) => [name, values[i]])) as unknown as AuditRoles;
}

async function receipt(pub: PublicClient, hash: Hex): Promise<"success" | "reverted" | null> {
  try {
    const mined = await pub.getTransactionReceipt({ hash });
    const canonical = await pub.getBlock({ blockNumber: mined.blockNumber });
    return canonical.hash === mined.blockHash ? mined.status : null;
  }
  catch (err) { if ((err as Error)?.name === "TransactionReceiptNotFoundError") return null;throw err; }
}

/** Only bond approval and the fixed dispute call can be signed by this adapter. */
export function auditIO(cfg: MarketChain, pub: PublicClient, wallet: WalletClient | undefined, account: Address | undefined, mode: "observe" | "challenge", job: AuditJob, save: AuditIO["save"]): AuditIO {
  const address = contractOf(cfg, job.proposal.kind);
  const send = async (call: { to: Address; data: Hex; value?: bigint }): Promise<Hex> => {
    if (!wallet?.account || !account || wallet.account.type !== "local" || wallet.account.address.toLowerCase() !== account.toLowerCase()) throw Error("Audit wallet must retain its matching local signing account");
    await pub.call({ account, ...call }); // Simulate; the contract rechecks permission, deadline and bond on execution.
    return wallet.sendTransaction({ account: wallet.account, chain: wallet.chain, ...call });
  };
  return {
    account, mode, load: () => loadAuditProposal(cfg, pub, job.proposal.kind, job.proposal.marketId),
    roles: () => readAuditRoles(pub, address), review: p => reviewProposal(p),
    receipt: hash => receipt(pub, hash), save,
    prepareBond: async () => {
      if (!account) throw Error("Audit signing key is unavailable");
      const expected = 2n * 10n ** BigInt(cfg.usdc.decimals);
      if (await pub.readContract({ address, abi: AUDIT_ROLE_ABI, functionName: "DISPUTE_BOND" }) !== expected) throw Error("Unsupported audit dispute bond");
      if (cfg.usdc.kind === "native") {
        if (await pub.getBalance({ address: account }) <= expected) throw Error("Audit account needs bond plus gas");
        return;
      }
      if (job.approvalTxHash) {
        const status = await receipt(pub, job.approvalTxHash);
        if (!status) throw Error("Audit bond approval is pending");
        delete job.approvalTxHash;await save(job);
        if (status !== "success") throw Error("Audit bond approval reverted");
      }
      const token = cfg.usdc.address;
      const [balance, allowance, gas] = await Promise.all([
        pub.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [account] }),
        pub.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account, address] }),
        pub.getBalance({ address: account }),
      ]);
      if (balance < expected || gas === 0n) throw Error("Audit account needs USDC bond and gas");
      if (allowance < expected) {
        job.approvalTxHash = await send({ to: token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [address, expected] }) });
        await save(job);
        throw Error("Audit bond approval submitted; recheck proposal after confirmation");
      }
    },
    submit: () => send(auditDisputeCall(cfg, job.proposal.kind, job.proposal.marketId)),
  };
}
