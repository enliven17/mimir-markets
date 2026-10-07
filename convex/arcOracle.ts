"use node";

// The Arc oracle as a Convex cron step (replaces the Railway loop in agents/oracle/solana.ts for Arc markets).
// Each tick, from the index (arc.oracleWork):
//   decide   past-deadline markets: agents/oracle/decide.ts (resolver spec, deadline prices, evidence + LLM, tiers),
//            then propose on chain with evidenceHash = sha256(audit bundle); the bundle is kept in arcVerdicts
//   finalize proposals whose dispute window has closed
//   refund   markets nobody settled within the 7-day grace (refundExpired)
//   pay      pool winners (and everyone on a refund) with claimFor: the money only ever goes to the user
// A deferred or failed decision is retried 10 minutes later. Disputes go to the owner (the arbiter), not here.
// Env: ARC_ORACLE_KEY (the contracts' oracle EOA), the LLM keys lib/llm.ts reads, ARC_* / MIMIR_* as arcSync.ts.
import type { PublicKey } from "@solana/web3.js";
import { createPublicClient, createWalletClient, http, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { decide, type SettlementDecision } from "../agents/oracle/decide";
import type { OnchainClaim } from "../lib/solana/client";
import { arcChain } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";

const V3 = parseAbi([
  "function resolveClaim(uint256 claimId, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash)",
  "function finalizeResolution(uint256 claimId)",
  "function refundExpired(uint256 claimId)",
]);
const POOL = parseAbi([
  "function resolve(uint256 id, uint8 outcome, string summary, bytes32 evidenceHash)",
  "function finalize(uint256 id)",
  "function refundExpired(uint256 id)",
  "function claimable(uint256 id, address user) view returns (uint256 payout, uint256 fee)",
  "function claimFor(uint256 id, address user)",
]);
const SIDE = { CREATOR_WINS: 1, CHALLENGERS_WIN: 2, DRAW: 3, UNRESOLVABLE: 4 } as const;
// Decisions fetch evidence and call an LLM (up to a minute each): a few per tick keeps the action well inside 10 min.
const MAX_DECISIONS_PER_TICK = 3;
const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

type Market = Doc<"arcMarkets">;
type Position = Doc<"arcPositions">;

/**
 * decide() was written for Solana claims and only reads addresses through
 * toBase58() / equals(); an Arc address behind that same face keeps it unchanged.
 */
const addr = (a: string) => ({ toBase58: () => a, equals: (o: { toBase58(): string }) => o.toBase58() === a }) as unknown as PublicKey;

/** The Arc market as the claim shape decide() reads. Pools: side A is the "creator" side, B the "challengers". */
function asClaim(m: Market, positions: Position[]): OnchainClaim {
  const units = (wei: string) => BigInt(wei) / 1_000_000_000_000n; // 18 dp → the 6-dp units decide() prints
  return {
    id: BigInt(m.marketId),
    creator: addr(m.creator),
    question: m.question,
    creatorPosition: m.labelA,
    counterPosition: m.labelB,
    resolutionUrl: m.resolutionUrl,
    category: m.category,
    creatorStake: units(m.stakeA),
    totalChallengerStake: units(m.stakeB),
    deadline: m.deadline,
    createdAt: m.createdAt,
    challengers: positions.filter((p) => p.user !== m.creator).map((p) => ({ addr: addr(p.user), stake: units(p.amount), paid: false })),
  } as unknown as OnchainClaim;
}

function setup() {
  const e = process.env;
  const cfg = arcConfig({ network: e.ARC_NETWORK, rpcUrl: e.ARC_RPC, mimirV3: e.MIMIR_V3_ADDRESS, mimirPool: e.MIMIR_POOL_ADDRESS });
  const key = e.ARC_ORACLE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("ARC_ORACLE_KEY is not set in the Convex env");
  const { mimirV3, mimirPool } = cfg.contracts;
  if (!mimirV3 || !mimirPool) throw new Error("MIMIR_V3_ADDRESS / MIMIR_POOL_ADDRESS are not set");
  const chain = arcChain(cfg);
  const account = privateKeyToAccount(key as Hex);
  const pub = createPublicClient({ chain, transport: http(cfg.chain.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(cfg.chain.rpcUrl) });
  // Operator addresses: markets they hold a position in settle on firm verdicts only (decide.ts).
  const house = new Set([account.address.toLowerCase(), ...(e.ARC_HOUSE_ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)]);
  return { pub, wallet, account, mimirV3, mimirPool, house };
}

type Setup = ReturnType<typeof setup>;

/** Simulate first (a revert costs nothing and says why), then send and wait. */
async function write(s: Setup, req: { address: Hex; abi: typeof V3 | typeof POOL; functionName: string; args: readonly unknown[] }): Promise<Hex> {
  const { request } = await s.pub.simulateContract({ ...req, account: s.account } as Parameters<Setup["pub"]["simulateContract"]>[0]);
  const hash = await s.wallet.writeContract(request as Parameters<Setup["wallet"]["writeContract"]>[0]);
  const rc = await s.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`reverted ${hash}`);
  return hash;
}

const errText = (e: unknown) => {
  const x = e as { shortMessage?: string; message?: string };
  return (x?.shortMessage ?? x?.message ?? String(e)).split("\n")[0];
};

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.arcAdmin.beat, { name: "arc-oracle" });
    if (process.env.MIMIR_PAUSE_ORACLE_SETTLEMENT === "1") return;
    const s = setup();
    const now = Math.floor(Date.now() / 1000);
    const work = await ctx.runQuery(internal.arc.oracleWork, { now });
    const contract = (kind: "vs" | "pool") => (kind === "vs" ? s.mimirV3 : s.mimirPool);
    let changed = false;

    for (const m of work.decide.slice(0, MAX_DECISIONS_PER_TICK)) {
      const tag = `[oracle] ${m.kind} #${m.marketId}`;
      try {
        // An uncontested pool refunds every stake whatever the outcome: propose DRAW without spending a model call,
        // so markets nobody took the other side of cost the backend nothing to close.
        if (m.kind === "pool" && (BigInt(m.stakeA) === 0n || BigInt(m.stakeB) === 0n)) {
          const summary = "Only one side was staked, so every stake is refunded.";
          const tx = await write(s, { address: s.mimirPool, abi: POOL, functionName: "resolve", args: [BigInt(m.marketId), SIDE.DRAW, summary, ZERO_HASH] });
          await ctx.runMutation(internal.arc.saveVerdict, { kind: m.kind, marketId: m.marketId, side: SIDE.DRAW, confidence: 100, summary, evidenceHash: ZERO_HASH, bundle: "{}", txHash: tx });
          console.log(`${tag}: uncontested, refund proposed ${tx}`);
          changed = true;
          continue;
        }
        const full = await ctx.runQuery(internal.arc.marketWithPositions, { kind: m.kind, marketId: m.marketId });
        const decision: SettlementDecision | null = await decide(
          { oracle: addr(s.account.address.toLowerCase()), house: s.house, jury: null },
          asClaim(m, full?.positions ?? []),
        );
        if (!decision) {
          console.log(`${tag}: deferred`);
          await ctx.runMutation(internal.arc.deferMarket, { kind: m.kind, marketId: m.marketId });
          continue;
        }
        const side = SIDE[decision.verdict.verdict];
        const summary = decision.verdict.explanation.slice(0, 500);
        const hash = toHex(decision.evidenceHash);
        const tx =
          m.kind === "vs"
            ? await write(s, { address: s.mimirV3, abi: V3, functionName: "resolveClaim", args: [BigInt(m.marketId), side, summary, decision.verdict.confidence, hash] })
            : await write(s, { address: s.mimirPool, abi: POOL, functionName: "resolve", args: [BigInt(m.marketId), side, summary, hash] });
        await ctx.runMutation(internal.arc.saveVerdict, {
          kind: m.kind,
          marketId: m.marketId,
          side,
          confidence: decision.verdict.confidence,
          summary,
          evidenceHash: hash,
          bundle: JSON.stringify(decision.bundle),
          txHash: tx,
        });
        console.log(`${tag}: proposed side ${side} (${decision.verdict.confidence}%) ${tx}`);
        changed = true;
      } catch (err) {
        console.warn(`${tag}: ${errText(err)}`);
        await ctx.runMutation(internal.arc.deferMarket, { kind: m.kind, marketId: m.marketId, error: errText(err) });
      }
    }

    for (const m of work.finalize) {
      try {
        const tx = await write(s, m.kind === "vs"
          ? { address: s.mimirV3, abi: V3, functionName: "finalizeResolution", args: [BigInt(m.marketId)] }
          : { address: s.mimirPool, abi: POOL, functionName: "finalize", args: [BigInt(m.marketId)] });
        console.log(`[oracle] ${m.kind} #${m.marketId}: finalized ${tx}`);
        changed = true;
      } catch (err) {
        console.warn(`[oracle] finalize ${m.kind} #${m.marketId}: ${errText(err)}`);
      }
    }

    for (const m of work.refund) {
      try {
        const tx = await write(s, { address: contract(m.kind), abi: m.kind === "vs" ? V3 : POOL, functionName: "refundExpired", args: [BigInt(m.marketId)] });
        console.log(`[oracle] ${m.kind} #${m.marketId}: refunded (grace over) ${tx}`);
        changed = true;
      } catch (err) {
        console.warn(`[oracle] refund ${m.kind} #${m.marketId}: ${errText(err)}`);
      }
    }

    for (const p of work.pay) {
      for (const user of p.users) {
        try {
          const [payout] = await s.pub.readContract({ address: s.mimirPool, abi: POOL, functionName: "claimable", args: [BigInt(p.marketId), user as Hex] });
          if (payout === 0n) continue;
          const tx = await write(s, { address: s.mimirPool, abi: POOL, functionName: "claimFor", args: [BigInt(p.marketId), user] });
          console.log(`[oracle] pool #${p.marketId}: paid ${user} ${tx}`);
          changed = true;
        } catch (err) {
          console.warn(`[oracle] pay pool #${p.marketId} ${user}: ${errText(err)}`);
        }
      }
    }

    if (changed) await ctx.scheduler.runAfter(0, internal.arcSync.sync, {});
  },
});
