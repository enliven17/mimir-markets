"use node";

// The Arc oracle as a Convex cron step (replaces the Railway loop in agents/oracle/solana.ts for Arc markets).
// Each tick, from the index (arc.oracleWork):
//   decide   past-deadline markets: agents/oracle/decide.ts (resolver spec, deadline prices, evidence + LLM, tiers),
//            then propose on chain with evidenceHash = sha256(audit bundle); the bundle is kept in arcVerdicts
//   finalize proposals whose dispute window has closed
//   refund   markets nobody settled within the 7-day grace (refundExpired)
//   pay      pool winners (and everyone on a refund) with claimFor: the money only ever goes to the user
// While a contract is paused (the owner's emergency stop) its proposals, finalizations and pool payouts revert, so they
// are skipped; refundExpired still runs (paused, it refunds every stake).
// A deferred or failed decision is retried with exponential backoff (lib/oracle-queue.ts). Disputes go to the owner (the arbiter), not here.
// Env: ARC_ORACLE_KEY (the contracts' oracle EOA), the LLM keys lib/llm.ts reads, ARC_* / MIMIR_* as arcSync.ts.
import { applyPayoutPolicy } from "../lib/oracle-payout-policy";
import type { PublicKey } from "@solana/web3.js";
import { createPublicClient, createWalletClient, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { decide, type SettlementDecision } from "../agents/oracle/decide";
import type { OnchainClaim } from "../lib/solana/client";
import { arcChain, arcTransport } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";

const V3 = parseAbi([
  "function resolveClaim(uint256 claimId, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash)",
  "function finalizeResolution(uint256 claimId)",
  "function refundExpired(uint256 claimId)",
  "function paused() view returns (bool)",
]);
const POOL = parseAbi([
  "function resolve(uint256 id, uint8 outcome, string summary, bytes32 evidenceHash)",
  "function finalize(uint256 id)",
  "function refundExpired(uint256 id)",
  "function claimable(uint256 id, address user) view returns (uint256 payout, uint256 fee)",
  "function claimFor(uint256 id, address user)",
  "function paused() view returns (bool)",
]);
const SIDE = { CREATOR_WINS: 1, CHALLENGERS_WIN: 2, DRAW: 3, UNRESOLVABLE: 4 } as const;
/** Longest wait between tries while a sports market waits for the final whistle. */
const SPORTS_RETRY_CAP_MINUTES = 10;
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
  const pub = createPublicClient({ chain, transport: arcTransport(cfg) });
  const wallet = createWalletClient({ account, chain, transport: arcTransport(cfg) });
  // Operator addresses: markets they hold a position in settle on firm verdicts only (decide.ts). The council's and
  // the market creator's Circle wallets are ours too, so a market baiting them is held to the same bar.
  const json = <T,>(name: string): T | null => {
    try {
      return JSON.parse(e[name] ?? "null") as T;
    } catch {
      return null;
    }
  };
  const council = Object.values(json<Record<string, { address?: string }>>("ARC_COUNCIL_WALLETS") ?? {}).map((w) => w.address ?? "");
  const creator = json<{ address?: string }>("ARC_CREATOR_WALLET")?.address ?? "";
  const house = new Set(
    [account.address, creator, ...council, ...(e.ARC_HOUSE_ADDRESSES ?? "").split(",")].map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  // Mainnet: only results resting on something the creator cannot edit pay out (lib/oracle-payout-policy.ts).
  const mainnet = cfg.network === "mainnet";
  const extraHosts = (e.ORACLE_SOURCE_ALLOWLIST ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return { pub, wallet, account, mimirV3, mimirPool, house, mainnet, extraHosts };
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
    // Unreadable counts as paused: a revert would only burn the retry budget.
    const isPaused = (address: Hex, abi: typeof V3 | typeof POOL) =>
      s.pub.readContract({ address, abi, functionName: "paused" } as Parameters<Setup["pub"]["readContract"]>[0]).then(Boolean, () => true);
    const [vsPaused, poolPaused] = await Promise.all([isPaused(s.mimirV3, V3), isPaused(s.mimirPool, POOL)]);
    const paused = (kind: "vs" | "pool") => (kind === "vs" ? vsPaused : poolPaused);
    if (vsPaused || poolPaused) console.log(`[oracle] paused: vs=${vsPaused} pool=${poolPaused}; proposing, finalizing and payouts skipped there`);
    let changed = false;

    for (const m of work.decide.filter((d) => !paused(d.kind)).slice(0, MAX_DECISIONS_PER_TICK)) {
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
        const raw: SettlementDecision | null = await decide(
          { oracle: addr(s.account.address.toLowerCase()), house: s.house, jury: null },
          asClaim(m, full?.positions ?? []),
        );
        if (!raw) {
          console.log(`${tag}: deferred`);
          // A game in progress ends within a couple of hours: look again every few minutes, not after a 2-hour backoff.
          const capMinutes = m.category === "sports" ? SPORTS_RETRY_CAP_MINUTES : undefined;
          await ctx.runMutation(internal.arc.deferMarket, { kind: m.kind, marketId: m.marketId, capMinutes });
          continue;
        }
        const decision = applyPayoutPolicy(raw, s.mainnet, s.extraHosts);
        if (!decision.policy.pay) console.log(`${tag}: payout policy → refund (${decision.policy.reason})`);
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

    for (const m of work.finalize.filter((f) => !paused(f.kind))) {
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

    for (const p of poolPaused ? [] : work.pay) {
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
