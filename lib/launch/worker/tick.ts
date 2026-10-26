// Mimir Launch: one Solana tick of one agent (ported from snipad worker/tick.ts): exits first, then (if allowed)
// a single entry. Never throws: any error becomes an 'error' event and the loop moves on.
import { mergeCandidates } from "../engine/candidates";
import { decide } from "../engine/decide";
import { MAX_RANKED } from "../engine/rank";
import { passingCandidates } from "../engine/rules";
import { dailyCapHit, dailyLossCap, entrySize, MIN_TRADE_LAMPORTS, minSpendableToTrade } from "../engine/sizing";
import type { SizeInput } from "../engine/sizing";
import { fillPrice, fmtSol, label, shortMint } from "../engine/sol";
import type { DataSource } from "../types";
import type { AgentRow, Candidate } from "../ports";
import { createContext, PersistError } from "./tick-context";
import type { TickContext, TickDeps } from "./tick-context";
import { manageExits } from "./tick-exits";
import { publicError } from "./log";
import { isSleeping, SLEEP_AFTER_TICKS, wakeCheckDue } from "./idle";
import type { exitDecision } from "../engine/exits";

export type { TickDeps } from "./tick-context";
export type TickResult = { sold: number; bought: string | null; paused: boolean; errors: number; skipped?: string };

export async function tickAgent(agentRow: AgentRow, deps: TickDeps): Promise<TickResult> {
  const result: TickResult = { sold: 0, bought: null, paused: false, errors: 0 };
  let step = "load";
  let ctx: TickContext | null = null;
  // Before any read: a fee claim recorded after this instant always earns a fresh wake check.
  const startedAt = deps.now();
  try {
    // Re-read: the row from the loop's listing may be stale (paused/killed/edited since).
    const agent = (await deps.repo.agent(agentRow.id)) ?? agentRow;
    if (agent.status === "pending") return { ...result, skipped: "status pending" };
    ctx = createContext(agent, deps);

    step = "exits";
    // Killed: sell everything whatever the price says. Paused: normal exit rules, no entries.
    const exits = await manageExits(agent, await deps.repo.openPositions(agent.id), ctx, agent.status === "killed" ? killExit : undefined);
    if (agent.status === "killed") {
      // Return SOL every tick, not only once flat: an unsellable (rugged) token must never hold the
      // owner's SOL hostage. Marked swept (stop ticking) once nothing is left to sell.
      if (!ctx.halted) {
        step = "sweep";
        await sweep(agent, deps, ctx, exits.remaining.length === 0);
      }
      return { ...result, sold: exits.sold, errors: exits.errors, skipped: "killed" };
    }
    if (agent.status !== "live") return { ...result, sold: exits.sold, errors: exits.errors, skipped: `status ${agent.status}` };
    Object.assign(result, { sold: exits.sold, errors: exits.errors });
    if (ctx.halted) return { ...result, paused: true };
    // Asleep (flat, not enough SOL): no balance RPC, no candidates, no LLM until a wake check is due.
    if (exits.remaining.length === 0 && !wakeCheckDue(agent.idle, startedAt)) return { ...result, skipped: "sleeping" };

    step = "risk";
    const [dailyPnl, walletSpendable] = await Promise.all([deps.repo.dailyPnl(agent.id), deps.executor.spendable(agent.wallet)]);
    // The fee pools sit in the same wallet but are owed: never traded.
    const reserved = agent.reservedLamports ?? 0n;
    const spendable = walletSpendable > reserved ? walletSpendable - reserved : 0n;
    const openCost = exits.remaining.reduce((s, p) => s + p.costLamports, 0n);
    const bankroll = spendable + openCost - dailyPnl; // ≈ equity at UTC midnight
    if (dailyCapHit(dailyPnl, bankroll, agent.risk.maxDailyLossPct)) {
      await deps.repo.setStatus(agent.id, "paused");
      await ctx.emit("rules", `daily loss cap hit (${fmtSol(dailyPnl)} SOL today, cap -${fmtSol(dailyLossCap(bankroll, agent.risk.maxDailyLossPct))} SOL), agent paused`);
      return { ...result, paused: true };
    }
    const maxOpen = deps.settings?.maxOpen ?? 3;
    const sizing: Omit<SizeInput, "mint"> = { spendable, bankrollLamports: bankroll, risk: agent.risk, dailyPnl, openPositions: exits.remaining, maxOpen, minLamports: deps.settings?.minTradeLamports };
    // Flat and entrySize could not size any trade: nothing to scan for. Same math as the real entry,
    // so the agent wakes on the first tick it could trade. With positions open it keeps running.
    if (exits.remaining.length === 0 && entrySize(sizing).lamports === 0n) {
      step = "idle";
      return { ...result, skipped: await rest(agent, deps, ctx, startedAt, spendable, dailyPnl) };
    }
    if (agent.idle) {
      step = "wake";
      await deps.repo.setIdle(agent.id, null);
      if (isSleeping(agent.idle)) await ctx.emit("rules", `awake: ${fmtSol(spendable)} SOL to trade with, scanning again`);
    }
    if (exits.remaining.length >= maxOpen) return { ...result, skipped: "max open positions" };

    step = "scan";
    const held = new Set(exits.remaining.map((p) => p.mint));
    const candidates = await gather(agent, deps, held);
    const passing = passingCandidates(candidates, agent.config.entry);
    if (passing.length === 0) {
      deps.log.debug("nothing passed rules", { agentId: agent.id, scanned: candidates.length });
      return { ...result, skipped: "no candidates" };
    }
    await ctx.emit("scan", `scanned ${candidates.length} tokens, ${passing.length} passed the entry rules`);

    step = "rank";
    const scores = await deps.ranker.rank({ thesis: agent.config.thesis, candidates: passing.slice(0, deps.settings?.maxRanked ?? MAX_RANKED) });

    step = "decide";
    const decision = decide({
      candidates: passing,
      conditions: agent.config.entry,
      scores,
      threshold: deps.settings?.threshold,
      exclude: agent.mint ? [agent.mint] : [],
      sizing,
    });
    for (const line of decision.lines) await ctx.emit(line.kind, line.text);
    if (decision.pause) {
      await deps.repo.setStatus(agent.id, "paused");
      return { ...result, paused: true };
    }
    if (!decision.intent) return result;

    step = "buy";
    const intent = decision.intent;
    const fill = await deps.executor.buy({ walletId: agent.walletId, wallet: agent.wallet, mint: intent.mint, lamports: intent.lamports, slippageBps: agent.risk.slippageBps, ownMint: agent.mint, protect: exits.remaining.map((p) => p.mint) });
    if (fill.tokens <= 0n || !fill.sig) throw new Error(`buy returned an empty fill (sig ${fill.sig || "none"})`);
    const entryPrice = entryPriceFor(fillPrice(fill.lamports, fill.tokens, fill.decimals), intent.priceSol, (fp) =>
      deps.log.warn("fill price far from quote, using quote as entry", { agentId: agent.id, mint: intent.mint, fillPrice: fp, quote: intent.priceSol, sig: fill.sig }),
    );
    const symbol = intent.symbol?.trim() || shortMint(intent.mint);
    const reason = `score ${intent.score.toFixed(2)}${intent.why ? `: ${intent.why}` : ""}`;
    await ctx.persist(`buy ${label(intent.symbol, intent.mint)}`, fill.sig, () =>
      deps.repo.openPosition(
        { agentId: agent.id, mint: intent.mint, symbol, tokens: fill.tokens, decimals: fill.decimals, costLamports: fill.lamports, entryPrice, highPrice: entryPrice },
        { lamports: fill.lamports, reason, sig: fill.sig },
      ),
    );
    await ctx.emit("buy", `bought ${label(intent.symbol, intent.mint)} for ${fmtSol(fill.lamports)} SOL (${reason})`);
    await deps.mirror?.buy(agent.id, intent.mint, agent.risk.slippageBps, fill.sig, { price: entryPrice, at: deps.now() });
    return { ...result, bought: intent.mint };
  } catch (err) {
    deps.log.error("tick failed", { agentId: agentRow.id, step, err });
    if (!(err instanceof PersistError)) {
      const emit = ctx?.emit ?? ((k, t) => deps.repo.logEvent(agentRow.id, k, t).catch(() => undefined));
      await emit("error", `${step} failed: ${publicError(err)}`);
    }
    return { ...result, errors: result.errors + 1, paused: result.paused || (ctx?.halted ?? false) };
  }
}

/**
 * A flat agent without enough SOL to trade: count the tick; on the SLEEP_AFTER_TICKS-th in a row
 * it falls asleep (one event). Already asleep: just record that the balance was checked.
 */
async function rest(agent: AgentRow, deps: TickDeps, ctx: TickContext, now: number, have: bigint, dailyPnl: bigint): Promise<string> {
  const prev = agent.idle;
  if (prev?.sleepingSince !== undefined) {
    await deps.repo.setIdle(agent.id, { ticks: prev.ticks, sleepingSince: prev.sleepingSince, checkedAt: now });
    return "sleeping";
  }
  const ticks = (prev?.ticks ?? 0) + 1;
  if (ticks < SLEEP_AFTER_TICKS) {
    await deps.repo.setIdle(agent.id, { ticks });
    return "idle";
  }
  await deps.repo.setIdle(agent.id, { ticks, sleepingSince: now, checkedAt: now });
  const need = minSpendableToTrade(agent.risk, dailyPnl, deps.settings?.minTradeLamports ?? MIN_TRADE_LAMPORTS);
  await ctx.emit(
    "rules",
    need === null
      ? `sleeping: its position size (${agent.risk.positionPct}%) is too small to ever reach the minimum trade. Send SOL to its wallet.`
      : `sleeping: not enough SOL to trade (needs ${fmtSol(need)} SOL, has ${fmtSol(have)} SOL). Send SOL to its wallet.`,
  );
  return "sleeping";
}

/** Kill switch: every position goes, at market. */
const killExit: typeof exitDecision = (a) => ({ action: "sell", fraction: 1, reason: "agent shut down by its owner", kind: "killed", high: a.position.highPrice, pnlPct: null });

/**
 * Shut down: burn whatever is left of the agent's own token (it can never be sold), close out the fee pools (the
 * creator pool goes with the sweep; a holders pool big enough for a last airdrop stays), send the rest of the SOL to
 * the owner, and mark the agent swept once flat and nothing is held back.
 */
async function sweep(agent: AgentRow, deps: TickDeps, ctx: TickContext, flat: boolean) {
  const { executor } = deps;
  if (agent.mint && executor.tokenBalance && executor.burn) {
    const own = await executor.tokenBalance(agent.wallet, agent.mint);
    if (own > 0n) {
      const burnSig = await executor.burn({ walletId: agent.walletId, wallet: agent.wallet, mint: agent.mint, tokens: own });
      await ctx.emit("burn", `burned the agent's remaining $${agent.ticker} (${own} units, ${burnSig.slice(0, 8)}…) on shutdown`);
    }
  }
  const keep = deps.repo.closeOutPools ? await deps.repo.closeOutPools(agent.id, deps.settings?.holdersMinLamports ?? DEFAULT_HOLDERS_MIN) : 0n;
  const spendable = await executor.spendable(agent.wallet);
  const lamports = spendable > keep ? spendable - keep : 0n;
  if (lamports > 1_000_000n) {
    const sig = await executor.transferSol({ walletId: agent.walletId, wallet: agent.wallet, to: agent.owner, lamports });
    await ctx.emit("rules", `returned ${fmtSol(lamports)} SOL to the owner (${sig.slice(0, 8)}…)`);
  }
  if (flat && keep === 0n) await deps.repo.markSwept(agent.id);
}

/** Shutdown sweep: a holders pool at least this big (0.1 SOL) stays for one last airdrop; a smaller one goes to the owner. */
const DEFAULT_HOLDERS_MIN = 100_000_000n;

/**
 * Entry price for exit rules. The fill is the truth (includes slippage) but must be on the same
 * scale as the price feed; a >3x gap means bad decimals or a bad quote, so fall back to the quote.
 */
export function entryPriceFor(fill: number | null, quote: number, onMismatch: (fill: number) => void): number {
  if (fill === null) return quote;
  const ratio = fill / quote;
  if (ratio > 3 || ratio < 1 / 3) {
    onMismatch(fill);
    return quote;
  }
  return fill;
}

/** Candidates from the agent's sources (+ helius when it watches whales), merged and enriched. */
async function gather(agent: AgentRow, deps: TickDeps, held: Set<string>): Promise<Candidate[]> {
  const ids = new Set<DataSource>(agent.config.sources);
  if (agent.config.whales.length > 0) ids.add("helius");
  const lists = await Promise.all(
    [...ids].map(async (id) => {
      const src = deps.sources[id];
      if (!src) return [];
      try {
        return await src.candidates({ whales: agent.config.whales });
      } catch (err) {
        deps.log.warn("source failed", { agentId: agent.id, source: id, err });
        return [];
      }
    }),
  );
  // H2: a coin launched by someone else naming this agent's wallet as creator is bait: never a candidate
  // (the executor also refuses to buy it). Only agent.mint (the DB record) is the agent's own token.
  let merged = mergeCandidates(lists).filter((c) => !held.has(c.mint) && c.mint !== agent.mint && c.creator !== agent.wallet);
  if (deps.enrich && merged.length > 0) {
    try {
      merged = await deps.enrich(merged);
    } catch (err) {
      deps.log.warn("enrich failed", { agentId: agent.id, err });
    }
  }
  return merged;
}

