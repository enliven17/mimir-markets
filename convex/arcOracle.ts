"use node";

// The oracle as a Convex cron step, one pass per enabled market chain (lib/chains/registry.ts).
// Each tick, per chain, from the index (arc.oracleWork):
//   decide   past-deadline markets: agents/oracle/decide.ts (resolver spec, deadline prices, evidence + LLM, tiers),
//            then propose on chain with evidenceHash = sha256(audit bundle); the bundle is kept in arcVerdicts
//   finalize proposals whose dispute window has closed
//   refund   markets nobody settled within the 7-day grace (refundExpired)
//   pay      pool winners (and everyone on a refund) with claimFor: the money only ever goes to the user
// While a contract is paused (the owner's emergency stop) its proposals, finalizations and pool payouts revert, so they
// are skipped; refundExpired still runs (paused, it refunds every stake).
// A deferred or failed decision is retried with exponential backoff (lib/oracle-queue.ts). Disputes go to the owner (the arbiter), not here.
// Linked markets (lib/chains/linked.ts): the same question on Base and Arc is decided once; the other chain's market
// proposes that same decision (its own late-stake and uncontested-refund rules still apply). A mainnet market never
// reuses a decision made for a testnet market.
// Env: ARC_ORACLE_KEY (the contracts' oracle EOA on Arc; gas in USDC), BASE_ORACLE_KEY (Base; else ARC_ORACLE_KEY; gas
// in ETH, keep it funded), the LLM keys lib/llm.ts reads, the chain env lib/chains/registry.ts serverMarketChains reads.
import { applyPayoutPolicy } from "../lib/oracle-payout-policy";
import { createPublicClient, createWalletClient, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { decide, fetchEvidence, type SettlementDecision } from "../agents/oracle/decide";
import { outcomeKnownAt } from "../agents/oracle/evaluate";
import { espnResult } from "../lib/espn";
import { lateStakes, lateStakeSummary } from "../lib/late-stakes";
import { sealBundle, type VerdictBundle } from "../lib/verdict-bundle";
import type { OnchainClaim } from "../lib/market-claim";
import { chainTransport, viemChainOf } from "../lib/chains/client";
import { houseAddresses, oracleKeyFor } from "../lib/chains/house";
import { reuseDecision, siblingDecision } from "../lib/chains/linked";
import { serverMarketChains, type MarketChain } from "../lib/chains/registry";

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

/** Addresses as the oracle and council compare them: lowercase. */
const addr = (a: string) => a.toLowerCase();

/** The indexed market as the claim shape decide() reads. Pools: side A is the "creator" side, B the "challengers". */
function asClaim(cfg: MarketChain, m: Market, positions: Position[]): OnchainClaim {
  const units = (wei: string) => BigInt(wei) / 1_000_000_000_000n; // 18-dp index units → the 6-dp units decide() prints
  return {
    id: BigInt(m.marketId),
    contract: (m.kind === "vs" ? cfg.contracts.mimirV3 : cfg.contracts.mimirPool)?.toLowerCase() ?? "",
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

function setup(cfg: MarketChain) {
  const e = process.env;
  const key = oracleKeyFor(cfg.id, e);
  if (!key) return null;
  const mimirV3 = cfg.contracts.mimirV3 as Hex;
  const mimirPool = cfg.contracts.mimirPool as Hex;
  const chain = viemChainOf(cfg);
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain, transport: chainTransport(cfg) });
  const wallet = createWalletClient({ account, chain, transport: chainTransport(cfg) });
  // Operator addresses: markets they hold a position in settle on firm verdicts only (decide.ts). The council's and
  // the market creator's Circle wallets (on every chain) are ours too, so a market baiting them is held to the same bar.
  const house = new Set(
    [account.address, ...houseAddresses(e), ...(e.ARC_HOUSE_ADDRESSES ?? "").split(",")].map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  // Mainnet: only results resting on something the creator cannot edit pay out (lib/oracle-payout-policy.ts).
  const mainnet = cfg.network === "mainnet";
  const extraHosts = (e.ORACLE_SOURCE_ALLOWLIST ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return { cfg, pub, wallet, account, mimirV3, mimirPool, house, mainnet, extraHosts };
}

type Setup = NonNullable<ReturnType<typeof setup>>;

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
    if (process.env.MIMIR_BACKEND_OFF === "1") return; // this deployment is switched off (crons.ts)
    await ctx.runMutation(internal.arcAdmin.beat, { name: "arc-oracle" });
    if (process.env.MIMIR_PAUSE_ORACLE_SETTLEMENT === "1") return;
    const registry = serverMarketChains();
    for (const id of registry.enabled) {
      const s = setup(registry.chains[id]);
      if (!s) {
        console.warn(`[oracle] ${id}: no oracle key (${id === "base" ? "BASE_ORACLE_KEY or " : ""}ARC_ORACLE_KEY); skipped`);
        continue;
      }
      try {
        await settleChain(ctx, s, registry.chains);
      } catch (err) {
        console.warn(`[oracle] ${id}: ${errText(err)}`);
      }
    }
  },
});

async function settleChain(ctx: ActionCtx, s: Setup, chains: Record<MarketChain["id"], MarketChain>): Promise<void> {
    const c = s.cfg.id;
    const now = Math.floor(Date.now() / 1000);
    const work = await ctx.runQuery(internal.arc.oracleWork, { chain: c, now });
    const contract = (kind: "vs" | "pool") => (kind === "vs" ? s.mimirV3 : s.mimirPool);
    // Unreadable counts as paused: a revert would only burn the retry budget.
    const isPaused = (address: Hex, abi: typeof V3 | typeof POOL) =>
      s.pub.readContract({ address, abi, functionName: "paused" } as Parameters<Setup["pub"]["readContract"]>[0]).then(Boolean, () => true);
    const [vsPaused, poolPaused] = await Promise.all([isPaused(s.mimirV3, V3), isPaused(s.mimirPool, POOL)]);
    const paused = (kind: "vs" | "pool") => (kind === "vs" ? vsPaused : poolPaused);
    if (vsPaused || poolPaused) console.log(`[oracle] ${c} paused: vs=${vsPaused} pool=${poolPaused}; proposing, finalizing and payouts skipped there`);
    let changed = false;

    for (const m of work.decide.filter((d) => !paused(d.kind)).slice(0, MAX_DECISIONS_PER_TICK)) {
      const tag = `[oracle] ${c} ${m.kind} #${m.marketId}`;
      try {
        // An uncontested pool refunds every stake whatever the outcome: propose DRAW without spending a model call,
        // so markets nobody took the other side of cost the backend nothing to close.
        if (m.kind === "pool" && (BigInt(m.stakeA) === 0n || BigInt(m.stakeB) === 0n)) {
          const summary = "Only one side was staked, so every stake is refunded.";
          const tx = await write(s, { address: s.mimirPool, abi: POOL, functionName: "resolve", args: [BigInt(m.marketId), SIDE.DRAW, summary, ZERO_HASH] });
          await ctx.runMutation(internal.arc.saveVerdict, { chain: c, kind: m.kind, marketId: m.marketId, side: SIDE.DRAW, confidence: 100, summary, evidenceHash: ZERO_HASH, bundle: "{}", txHash: tx, ...(m.pairKey ? { pairKey: m.pairKey } : {}) });
          console.log(`${tag}: uncontested, refund proposed ${tx}`);
          changed = true;
          continue;
        }
        // A linked market already decided on another chain: propose that same decision (lib/chains/linked.ts).
        const linked = m.pairKey
          ? siblingDecision(
              (await ctx.runQuery(internal.arc.linkedVerdicts, { pairKey: m.pairKey })).filter((v) => !(s.mainnet && chains[v.chain]?.network !== "mainnet")),
              c,
            )
          : null;
        let side: number;
        let confidence: number;
        let summary: string;
        let hash: Hex;
        let bundle: unknown;
        let verdictName: string;
        if (linked) {
          const r = reuseDecision(linked);
          side = r.side;
          confidence = r.confidence;
          summary = r.summary;
          bundle = JSON.parse(r.bundle || "{}");
          hash = (r.evidenceHash as Hex | null) ?? toHex(sealBundle(bundle as VerdictBundle).bytes);
          verdictName = Object.entries(SIDE).find(([, n]) => n === side)?.[0] ?? String(side);
          console.log(`${tag}: linked (${m.pairKey}), reusing the ${linked.chain} decision: side ${side}`);
        } else {
          const full = await ctx.runQuery(internal.arc.marketWithPositions, { chain: c, kind: m.kind, marketId: m.marketId });
          const raw: SettlementDecision | null = await decide(
            { oracle: addr(s.account.address.toLowerCase()), house: s.house, jury: null },
            asClaim(s.cfg, m, full?.positions ?? []),
          );
          if (!raw) {
            console.log(`${tag}: deferred`);
            // A game in progress ends within a couple of hours: look again every few minutes, not after a 2-hour backoff.
            const capMinutes = m.category === "sports" ? SPORTS_RETRY_CAP_MINUTES : undefined;
            await ctx.runMutation(internal.arc.deferMarket, { chain: c, kind: m.kind, marketId: m.marketId, capMinutes });
            continue;
          }
          const decision = applyPayoutPolicy(raw, s.mainnet, s.extraHosts);
          if (!decision.policy.pay) console.log(`${tag}: payout policy → refund (${decision.policy.reason})`);
          side = SIDE[decision.verdict.verdict];
          confidence = decision.verdict.confidence;
          summary = decision.verdict.explanation.slice(0, 500);
          hash = toHex(decision.evidenceHash);
          bundle = decision.bundle;
          verdictName = decision.verdict.verdict;
        }
        const decided = side;
        const decidedSummary = summary;
        // A winner only if nobody staked once the outcome was known (lib/late-stakes.ts); else everyone is refunded.
        if (side === SIDE.CREATOR_WINS || side === SIDE.CHALLENGERS_WIN) {
          // An ESPN game was known from kickoff (lib/espn.ts); anything else asks the model.
          const espn = await espnResult(m.resolutionUrl);
          const knownAt =
            espn && Number.isFinite(espn.startAt)
              ? espn.startAt
              : await outcomeKnownAt({ question: m.question, resolutionUrl: m.resolutionUrl, deadline: m.deadline }, (await fetchEvidence(m.resolutionUrl)).text);
          const late = lateStakes(knownAt, await ctx.runQuery(internal.arc.stakeTimes, { chain: c, kind: m.kind, marketId: m.marketId }));
          if (knownAt !== null && late.length) {
            side = SIDE.UNRESOLVABLE;
            summary = lateStakeSummary(knownAt, late);
            bundle = { ...(bundle as object), lateStakeRefund: { knownAt, lateStakes: late, overriddenVerdict: verdictName } };
            hash = toHex(sealBundle(bundle as VerdictBundle).bytes);
            console.log(`${tag}: ${late.length} late stake(s) after ${knownAt}, refund instead of ${verdictName}`);
          }
        }
        const tx =
          m.kind === "vs"
            ? await write(s, { address: s.mimirV3, abi: V3, functionName: "resolveClaim", args: [BigInt(m.marketId), side, summary, confidence, hash] })
            : await write(s, { address: s.mimirPool, abi: POOL, functionName: "resolve", args: [BigInt(m.marketId), side, summary, hash] });
        await ctx.runMutation(internal.arc.saveVerdict, {
          chain: c,
          kind: m.kind,
          marketId: m.marketId,
          side,
          decided,
          ...(decidedSummary !== summary ? { decidedSummary } : {}),
          ...(m.pairKey ? { pairKey: m.pairKey } : {}),
          confidence,
          summary,
          evidenceHash: hash,
          bundle: JSON.stringify(bundle),
          txHash: tx,
        });
        console.log(`${tag}: proposed side ${side} (${confidence}%) ${tx}`);
        changed = true;
      } catch (err) {
        console.warn(`${tag}: ${errText(err)}`);
        await ctx.runMutation(internal.arc.deferMarket, { chain: c, kind: m.kind, marketId: m.marketId, error: errText(err) });
      }
    }

    for (const m of work.finalize.filter((f) => !paused(f.kind))) {
      try {
        const tx = await write(s, m.kind === "vs"
          ? { address: s.mimirV3, abi: V3, functionName: "finalizeResolution", args: [BigInt(m.marketId)] }
          : { address: s.mimirPool, abi: POOL, functionName: "finalize", args: [BigInt(m.marketId)] });
        console.log(`[oracle] ${c} ${m.kind} #${m.marketId}: finalized ${tx}`);
        changed = true;
      } catch (err) {
        console.warn(`[oracle] ${c} finalize ${m.kind} #${m.marketId}: ${errText(err)}`);
      }
    }

    for (const m of work.refund) {
      try {
        const tx = await write(s, { address: contract(m.kind), abi: m.kind === "vs" ? V3 : POOL, functionName: "refundExpired", args: [BigInt(m.marketId)] });
        console.log(`[oracle] ${c} ${m.kind} #${m.marketId}: refunded (grace over) ${tx}`);
        changed = true;
      } catch (err) {
        console.warn(`[oracle] ${c} refund ${m.kind} #${m.marketId}: ${errText(err)}`);
      }
    }

    for (const p of poolPaused ? [] : work.pay) {
      for (const user of p.users) {
        try {
          const [payout] = await s.pub.readContract({ address: s.mimirPool, abi: POOL, functionName: "claimable", args: [BigInt(p.marketId), user as Hex] });
          if (payout === 0n) continue;
          const tx = await write(s, { address: s.mimirPool, abi: POOL, functionName: "claimFor", args: [BigInt(p.marketId), user] });
          console.log(`[oracle] ${c} pool #${p.marketId}: paid ${user} ${tx}`);
          changed = true;
        } catch (err) {
          console.warn(`[oracle] ${c} pay pool #${p.marketId} ${user}: ${errText(err)}`);
        }
      }
    }

    if (changed) await ctx.scheduler.runAfter(0, internal.arcSync.sync, { chain: c });
}
