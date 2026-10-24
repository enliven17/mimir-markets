// Paper accounting only. This module deliberately has no wallet, signer, RPC or execution dependency.
import { decide } from "../launch/engine/decide";
import { exitDecision } from "../launch/engine/exits";
import { dailyCapHit } from "../launch/engine/sizing";
import { marketCandidates, pickStake, type MarketView } from "../launch/markets";
import type { Candidate } from "../launch/ports";
import { DEMO, type DemoAgent, type DemoState, type DemoStake } from "./types";

const atomic = (v: number) => BigInt(Math.round(v * 1e9));
const validPrice = (p: number | null | undefined): p is number => typeof p === "number" && Number.isFinite(p) && p > 0;

export function demoEvent(state: DemoState, now: number, kind: string, text: string): void {
  state.events = [{ at: now, kind, text: text.slice(0, 300) }, ...state.events].slice(0, DEMO.history);
}

export function tradeDemo(agent: DemoAgent, candidates: readonly Candidate[], scores: ReadonlyMap<string, { score: number; why: string }>, now: number): { state: DemoState; pause: boolean } {
  const state: DemoState = JSON.parse(JSON.stringify(agent.state));
  const { config, risk } = agent.trading;
  if (!agent.trading.enabled || !config || !risk) return { state, pause: false };
  const day = Math.floor(now / 86_400_000);
  if (state.day !== day) {
    state.day = day;
    state.dailyPnl = 0;
    state.dayBankroll = state.cash + state.positions.reduce((s, p) => s + p.cost, 0);
  }
  const prices = new Map(candidates.filter((c) => validPrice(c.priceSol)).map((c) => [c.mint, c.priceSol!]));
  for (const position of [...state.positions]) {
    const price = prices.get(position.mint);
    const exit = exitDecision({ position, price, config, risk, now });
    if (validPrice(price)) position.price = price;
    position.highPrice = exit.high;
    // Never fabricate a fill from a stale mark, even for max-hold or shutdown.
    if (!validPrice(price) || (exit.action !== "sell" && agent.status !== "killed")) continue;
    const fill = price * (1 - risk.slippageBps / 10_000);
    const proceeds = position.quantity * fill;
    const pnl = proceeds - position.cost;
    const reason = agent.status === "killed" ? "Agent shut down by its owner" : exit.reason;
    state.cash += proceeds;
    state.pnl += pnl;
    state.dailyPnl += pnl;
    state.positions = state.positions.filter((p) => p.mint !== position.mint);
    state.trades.unshift({ at: now, side: "sell", mint: position.mint, symbol: position.symbol, amount: proceeds, price: fill, pnl, reason });
    demoEvent(state, now, "sell", `Preview sold ${position.symbol}: ${reason}.`);
  }
  let pause = dailyCapHit(atomic(state.dailyPnl), atomic(state.dayBankroll), risk.maxDailyLossPct);
  if (pause && agent.status === "live") demoEvent(state, now, "rules", "Daily loss cap reached. Preview agent paused.");
  if (!pause && agent.status === "live") {
    const decision = decide({ candidates: candidates.filter((c) => config.sources.includes(c.source)), conditions: config.entry, scores,
      sizing: { spendable: atomic(state.cash), bankrollLamports: atomic(state.dayBankroll), dailyPnl: atomic(state.dailyPnl), risk, openPositions: state.positions, maxOpen: DEMO.maxOpen,
        minLamports: agent.chain === "robinhood" ? 1_000_000n : undefined } });
    pause = decision.pause;
    if (decision.intent) {
      const i = decision.intent;
      const amount = Number(i.lamports) / 1e9;
      const price = i.priceSol * (1 + risk.slippageBps / 10_000);
      const quantity = amount / price;
      if (Number.isFinite(quantity) && quantity > 0 && amount <= state.cash) {
        state.cash -= amount;
        state.positions.push({ mint: i.mint, symbol: i.symbol, quantity, cost: amount, entryPrice: price, highPrice: price, price: i.priceSol, openedAt: now });
        state.trades.unshift({ at: now, side: "buy", mint: i.mint, symbol: i.symbol, amount, price, pnl: 0, reason: i.why });
        demoEvent(state, now, "buy", `Preview bought ${i.symbol}. ${i.why}`);
      }
    }
  }
  state.trades = state.trades.slice(0, DEMO.history);
  return { state, pause };
}

export function stakeDemo(agent: DemoAgent, state: DemoState, markets: readonly MarketView[], held: readonly DemoStake[], judged: ReadonlyMap<number, { pA: number; why: string }>, now: number): Omit<DemoStake, "id"> | null {
  if (agent.status !== "live" || !agent.markets.enabled) return null;
  const open = held.filter((s) => s.status === "open").reduce((sum, s) => sum + s.amount, 0);
  const candidates = marketCandidates(markets, agent.markets.rules, new Set(held.map((s) => `pool:${s.marketId}`)), Math.floor(now / 1000));
  const pick = pickStake(judged, candidates, agent.markets.rules, Math.min(state.usdc, agent.markets.budgetUsdc - open));
  if (!pick) return null;
  state.usdc -= pick.stakeUsdc;
  demoEvent(state, now, "stake", `Preview staked ${pick.stakeUsdc.toFixed(2)} USDC on ${pick.side === 1 ? pick.market.labelA : pick.market.labelB}. ${pick.why}`);
  return { agentId: agent.id, agentName: agent.name, agentSeed: agent.avatarSeed, kind: "pool", marketId: pick.market.marketId,
    question: pick.market.question, side: pick.side, label: pick.side === 1 ? pick.market.labelA : pick.market.labelB,
    amount: pick.stakeUsdc, p: pick.p, edge: pick.edge, why: pick.why.slice(0, 200), at: now, status: "open", payout: 0,
    same: pick.side === 1 ? pick.market.usdcA : pick.market.usdcB, other: pick.side === 1 ? pick.market.usdcB : pick.market.usdcA };
}

/** Hypothetical pari-mutuel proceeds at the final real pool, including this one paper stake. */
export function settleDemoStake(stake: DemoStake, market: { status: string; winner: number; stakeA: string; stakeB: string; feeBps?: number }): Pick<DemoStake, "status" | "payout"> | null {
  if (stake.status !== "open") return null;
  const net = stake.amount * (1 - DEMO.marketEntryFeeBps / 10_000);
  if (market.status === "cancelled" || (market.status === "resolved" && ![1, 2].includes(market.winner))) return { status: "refunded", payout: net };
  if (market.status !== "resolved") return null;
  if (market.winner !== stake.side) return { status: "lost", payout: 0 };
  const same = Number(BigInt(stake.side === 1 ? market.stakeA : market.stakeB)) / 1e18;
  const other = Number(BigInt(stake.side === 1 ? market.stakeB : market.stakeA)) / 1e18;
  const profit = net * other / (same + net);
  return { status: "won", payout: net + profit };
}
