/**
 * Mimir Sentinel: re-verifies every BSC oracle proposal still inside its dispute window and, with --dispute,
 * disputes the faulty ones from your own wallet. Any Binance Agent ID holder can run it: the contracts let an
 * Agent ID holder dispute without holding a position. The 2 USDC bond comes back when the arbiter agrees.
 *
 *   SENTINEL_PRIVATE_KEY=0x... npx tsx agents/sentinel/run.ts            # report only
 *   SENTINEL_PRIVATE_KEY=0x... npx tsx agents/sentinel/run.ts --dispute  # also send dispute transactions
 *
 * Env: the BSC chain env lib/chains/registry.ts reads (network, contract addresses), MIMIR_API (default
 * https://mimirmarkets.xyz), SENTINEL_LOOKBACK_BLOCKS (default 200000). The key stays on your machine; it signs
 * only approve(exact bond) and dispute(id).
 */
import { createWalletClient, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { hasBscAgentId } from "../../lib/bsc/agent-id";
import { chainPublicClient, chainTransport, ERC20_ABI, viemChainOf } from "../../lib/chains/client";
import { serverMarketChains, type MarketChain } from "../../lib/chains/registry";
import { fetchPriceReadings } from "../../lib/server/price-sources";
import type { VerdictBundle } from "../../lib/verdict-bundle";
import { auditProposal, type Proposal } from "./check";

const V3 = parseAbi([
  "event ResolutionProposed(uint256 indexed id, uint8 winnerSide, uint8 confidence, bytes32 evidenceHash, uint256 disputableUntil)",
  "function getClaim(uint256) view returns (address creator, string question, string creatorPosition, string counterPosition, string resolutionUrl, uint256 creatorStake, uint256 totalChallengerStake, uint256 reservedCreatorLiability, uint256 deadline, uint8 state, uint8 winnerSide, string resolutionSummary, uint8 confidence, string category, uint256 parentId, uint256 challengerCount, uint256 createdAt, bytes32 evidenceHash)",
  "function disputeResolution(uint256 claimId)",
  "function DISPUTE_BOND() view returns (uint256)",
]);
const POOL = parseAbi([
  "event ResolutionProposed(uint256 indexed id, uint8 outcome, bytes32 evidenceHash, uint256 disputableUntil)",
  "function getMarket(uint256) view returns (address creator, uint256 deadline, uint256 createdAt, uint8 state, uint8 outcome, uint256 totalA, uint256 totalB)",
  "function getMarketText(uint256) view returns (string question, string labelA, string labelB, string resolutionUrl, string category, string summary)",
  "function dispute(uint256 id)",
  "function DISPUTE_BOND() view returns (uint256)",
]);
const CHUNK = 5_000n; // public BSC RPCs cap eth_getLogs ranges

type Kind = "vs" | "pool";
interface Open {
  kind: Kind;
  id: bigint;
  side: number;
  evidenceHash: Hex;
  until: bigint;
}
interface Ctx {
  cfg: MarketChain;
  pub: ReturnType<typeof chainPublicClient>;
  v3: Address;
  pool: Address;
}

async function main() {
  const send = process.argv.includes("--dispute");
  const key = process.env.SENTINEL_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("set SENTINEL_PRIVATE_KEY (your own wallet; it never leaves this machine)");
  const cfg = serverMarketChains().chains.bsc;
  const { mimirV3: v3, mimirPool: pool } = cfg.contracts;
  if (!v3 || !pool) throw new Error("BSC contract addresses are not configured");
  const ctx: Ctx = { cfg, pub: chainPublicClient(cfg), v3: v3 as Address, pool: pool as Address };
  const api = (process.env.MIMIR_API ?? "https://mimirmarkets.xyz").replace(/\/$/, "");
  const account = privateKeyToAccount(key);
  if (!(await hasBscAgentId(account.address, { chain: cfg }))) {
    console.warn(`[sentinel] ${account.address} holds no Agent ID: it can only dispute markets it is in`);
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const open = (await proposals(ctx, BigInt(process.env.SENTINEL_LOOKBACK_BLOCKS ?? 200_000))).filter((o) => o.until > now);
  console.log(`[sentinel] ${open.length} proposal(s) inside their dispute window`);

  for (const o of open) {
    const tag = `${o.kind} #${o.id}`;
    try {
      const p = await proposalOf(ctx, o);
      const bundle = await bundleOf(api, o);
      const prices = bundle?.prices ? await fetchPriceReadings(bundle.prices.symbol, p.deadline * 1000).catch(() => []) : [];
      const faults = auditProposal(p, bundle, prices);
      if (!faults.length) {
        console.log(`[sentinel] ${tag}: verified`);
        continue;
      }
      console.log(`[sentinel] ${tag}: FAULT\n  - ${faults.join("\n  - ")}`);
      if (send) console.log(`[sentinel] ${tag}: disputed in ${await dispute(ctx, key, o)}`);
    } catch (err) {
      // One unreadable proposal must not stop the watch over the others.
      console.warn(`[sentinel] ${tag}: skipped, ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function proposals({ pub, v3, pool }: Ctx, lookback: bigint): Promise<Open[]> {
  const head = await pub.getBlockNumber();
  const out: Open[] = [];
  for (let from = head > lookback ? head - lookback : 0n; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const [vs, pl] = await Promise.all([
      pub.getContractEvents({ address: v3, abi: V3, eventName: "ResolutionProposed", fromBlock: from, toBlock: to }),
      pub.getContractEvents({ address: pool, abi: POOL, eventName: "ResolutionProposed", fromBlock: from, toBlock: to }),
    ]);
    for (const l of vs) out.push({ kind: "vs", id: l.args.id!, side: l.args.winnerSide!, evidenceHash: l.args.evidenceHash!, until: l.args.disputableUntil! });
    for (const l of pl) out.push({ kind: "pool", id: l.args.id!, side: l.args.outcome!, evidenceHash: l.args.evidenceHash!, until: l.args.disputableUntil! });
  }
  return out;
}

/** The claim as it is on chain, not as any server describes it. */
async function proposalOf({ pub, v3, pool }: Ctx, o: Open): Promise<Proposal> {
  const base = { side: o.side, evidenceHash: o.evidenceHash };
  if (o.kind === "vs") {
    const c = await pub.readContract({ address: v3, abi: V3, functionName: "getClaim", args: [o.id] });
    return { ...base, question: c[1], creatorPosition: c[2], counterPosition: c[3], resolutionUrl: c[4], deadline: Number(c[8]) };
  }
  const [m, t] = await Promise.all([
    pub.readContract({ address: pool, abi: POOL, functionName: "getMarket", args: [o.id] }),
    pub.readContract({ address: pool, abi: POOL, functionName: "getMarketText", args: [o.id] }),
  ]);
  return { ...base, question: t[0], creatorPosition: t[1], counterPosition: t[2], resolutionUrl: t[3], deadline: Number(m[1]) };
}

async function bundleOf(api: string, o: Open): Promise<VerdictBundle | null> {
  const res = await fetch(`${api}/api/markets/${o.kind}/${o.id}?chain=bsc`).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as { data?: { market?: { verdict?: { evidenceHash?: string | null; bundle?: string | null } | null } } };
  const v = body.data?.market?.verdict;
  // Only the bundle published for THIS committed hash counts.
  if (!v?.bundle || v.evidenceHash?.toLowerCase() !== o.evidenceHash.toLowerCase()) return null;
  try {
    return JSON.parse(v.bundle) as VerdictBundle;
  } catch {
    return null;
  }
}

async function dispute({ cfg, pub, v3, pool }: Ctx, key: Hex, o: Open): Promise<Hex> {
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: viemChainOf(cfg), transport: chainTransport(cfg) });
  const target = o.kind === "vs" ? v3 : pool;
  const bond = await pub.readContract({ address: target, abi: o.kind === "vs" ? V3 : POOL, functionName: "DISPUTE_BOND" });
  // Exactly the bond, never an unlimited approval.
  const approve = await wallet.writeContract({ address: cfg.usdc.address as Address, abi: ERC20_ABI, functionName: "approve", args: [target, bond] });
  await pub.waitForTransactionReceipt({ hash: approve });
  const hash =
    o.kind === "vs"
      ? await wallet.writeContract({ address: v3, abi: V3, functionName: "disputeResolution", args: [o.id] })
      : await wallet.writeContract({ address: pool, abi: POOL, functionName: "dispute", args: [o.id] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`dispute reverted ${hash}`);
  return hash;
}

main().catch((err) => {
  console.error("[sentinel]", err instanceof Error ? err.message : err);
  process.exit(1);
});
