// Exit management for one agent: price every open position, apply exitDecision, sell, persist.
// Each position is isolated: one failing sell never blocks the others.
import { exitDecision } from "../engine/exits";
import { fmtSol, label, mulBps } from "../engine/sol";
import type { AgentRow, PositionRow } from "../ports";
import { PersistError } from "./tick-context";
import type { TickContext } from "./tick-context";
import { publicError } from "./log";

export type ExitsResult = { remaining: PositionRow[]; sold: number; errors: number };

/** Tokens to sell for a fraction in 0..1; the whole position at ≥ 1. */
export function tokensFor(position: PositionRow, fraction: number): bigint {
  if (!(fraction > 0)) return 0n;
  if (fraction >= 1) return position.tokens;
  return mulBps(position.tokens, BigInt(Math.floor(fraction * 10_000)));
}

export async function manageExits(
  agent: AgentRow,
  positions: PositionRow[],
  ctx: TickContext,
  decideExit: typeof exitDecision = exitDecision,
): Promise<ExitsResult> {
  const { deps, emit } = ctx;
  if (positions.length === 0) return { remaining: [], sold: 0, errors: 0 };
  let prices = new Map<string, number>();
  try {
    prices = await deps.prices.prices([...new Set(positions.map((p) => p.mint))]);
  } catch (err) {
    deps.log.warn("price feed failed", { agentId: agent.id, err });
  }

  const remaining: PositionRow[] = [];
  let sold = 0;
  let errors = 0;
  for (const pos of positions) {
    const name = label(pos.symbol, pos.mint);
    try {
      const d = decideExit({ position: pos, price: prices.get(pos.mint), risk: agent.risk, config: agent.config, now: deps.now() });
      if (d.high > pos.highPrice && Number.isFinite(d.high)) {
        await deps.repo.setHighPrice(pos.id, d.high).catch((err) => deps.log.warn("setHighPrice failed", { positionId: pos.id, err }));
      }
      if (d.action === "hold") {
        remaining.push({ ...pos, highPrice: Math.max(pos.highPrice, d.high) });
        continue;
      }
      const tokens = tokensFor(pos, d.fraction);
      if (tokens <= 0n) {
        remaining.push(pos);
        continue;
      }
      const fill = await deps.executor.sell({ walletId: agent.walletId, wallet: agent.wallet, mint: pos.mint, tokens, slippageBps: agent.risk.slippageBps, ownMint: agent.mint, protect: positions.map((p) => p.mint) });
      // Account with what the confirmed tx actually sold (the executor caps a sell at the wallet's
      // balance), never the request: the position keeps exactly the tokens that are still there.
      const soldTokens = fill.tokens > 0n ? fill.tokens : tokens;
      const full = tokens >= pos.tokens || soldTokens >= pos.tokens;
      const cost = full ? pos.costLamports : (pos.costLamports * soldTokens) / pos.tokens;
      const pnl = fill.lamports - cost;
      const sell = { lamports: fill.lamports, tokens: soldTokens, reason: d.reason, sig: fill.sig };
      await ctx.persist(`sell ${name}`, fill.sig, () => (full ? deps.repo.closePosition(pos.id, sell) : deps.repo.reducePosition(pos.id, sell)));
      const share = full ? 100 : Number((soldTokens * 100n) / pos.tokens);
      await emit("sell", `${d.reason} on ${name}, sold ${share}% for ${fmtSol(fill.lamports)} SOL (${pnl >= 0n ? "+" : ""}${fmtSol(pnl)} SOL)`);
      sold += 1;
      // Followers sell the same share of theirs (paused ones too: they exit with the agent).
      await deps.mirror?.sell(agent.id, pos.mint, full ? 1 : Number((soldTokens * 10_000n) / pos.tokens) / 10_000, agent.risk.slippageBps, fill.sig);
      if (!full) remaining.push({ ...pos, tokens: pos.tokens - soldTokens, costLamports: pos.costLamports - cost });
    } catch (err) {
      errors += 1;
      remaining.push(pos);
      deps.log.error("exit failed", { agentId: agent.id, positionId: pos.id, mint: pos.mint, err });
      if (!(err instanceof PersistError)) await emit("error", `exit on ${name} failed: ${publicError(err)}`);
      if (ctx.halted) break;
    }
  }
  return { remaining, sold, errors };
}
