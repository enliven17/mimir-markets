// Mimir Launch: in-memory Repo / Executor / sources for the worker tests (ported from snipad worker/fakes.ts).
import type { AgentRow, Candidate, EventKind, Executor, Fill, MarketSource, PositionRow, PriceFeed, Ranker, Repo } from "../../lib/launch/ports";
import { config, risk } from "../../lib/launch/engine/fixtures";
import type { TickDeps } from "../../lib/launch/worker/tick-context";
import { silentLog } from "../../lib/launch/worker/log";

export const SOL = 1_000_000_000n;

export const agentRow = (over: Partial<AgentRow> = {}): AgentRow => ({
  id: "pnut",
  name: "Peanut",
  ticker: "PNUT",
  mint: "PnutMint1111111111111111111111111111111111",
  owner: "Owner11111111111111111111111111111111111111",
  walletId: "w1",
  wallet: "Wallet1111111111111111111111111111111111111",
  status: "live",
  config: config(),
  risk: risk(),
  createdAt: new Date(0),
  ...over,
});

export function fakeRepo(agent: AgentRow, positions: PositionRow[] = []) {
  const state = {
    agent: { ...agent },
    positions: [...positions],
    events: [] as { kind: EventKind; text: string }[],
    trades: [] as { side: "buy" | "sell"; lamports: bigint; tokens: bigint; sig: string; pnl?: bigint }[],
    dailyPnl: 0n,
    failWrites: 0,
    swept: false,
  };
  let nextId = 100;
  const guard = () => {
    if (state.failWrites > 0) {
      state.failWrites--;
      throw new Error("db down");
    }
  };
  const repo: Repo = {
    agent: async (id) => (id === state.agent.id ? state.agent : null),
    openPositions: async () => state.positions.map((p) => ({ ...p })),
    async openPosition(p, buy) {
      guard();
      const row: PositionRow = { ...p, id: String(nextId++), openedAt: new Date() };
      state.positions.push(row);
      state.trades.push({ side: "buy", lamports: buy.lamports, tokens: p.tokens, sig: buy.sig });
      return row;
    },
    async closePosition(id, s) {
      guard();
      const p = state.positions.find((x) => x.id === id);
      if (!p) throw new Error("no position");
      state.positions = state.positions.filter((x) => x.id !== id);
      state.trades.push({ side: "sell", lamports: s.lamports, tokens: s.tokens, sig: s.sig, pnl: s.lamports - p.costLamports });
      state.dailyPnl += s.lamports - p.costLamports;
    },
    async reducePosition(id, s) {
      guard();
      const p = state.positions.find((x) => x.id === id);
      if (!p) throw new Error("no position");
      const cost = (p.costLamports * s.tokens) / p.tokens;
      state.positions = state.positions.map((x) => (x.id === id ? { ...x, tokens: x.tokens - s.tokens, costLamports: x.costLamports - cost } : x));
      state.trades.push({ side: "sell", lamports: s.lamports, tokens: s.tokens, sig: s.sig, pnl: s.lamports - cost });
    },
    async setHighPrice(id, price) {
      state.positions = state.positions.map((x) => (x.id === id ? { ...x, highPrice: price } : x));
    },
    dailyPnl: async () => state.dailyPnl,
    async logEvent(_id, kind, text) {
      state.events.push({ kind, text });
    },
    async setStatus(_id, status) {
      state.agent = { ...state.agent, status };
    },
    async markSwept() {
      state.swept = true;
    },
    async setIdle(_id, s) {
      state.agent = { ...state.agent, idle: s ? { ...s } : undefined };
    },
  };
  return { repo, state };
}

export function fakeExecutor(opts: { spendable?: bigint; sellLamports?: bigint; failBuy?: boolean; failSell?: boolean; ownTokens?: bigint; /** Tokens the chain actually sold (default: what was asked). */ sellTokens?: bigint } = {}) {
  const calls: { op: "buy" | "sell" | "transfer" | "burn"; mint: string; amount: bigint }[] = [];
  /** Raw buy/sell arguments (ownMint, protect, slippage…). */
  const args: Record<string, unknown>[] = [];
  let n = 0;
  /** Balance reads (RPC) made. */
  const reads = { spendable: 0 };
  const executor: Executor = {
    async buy(a): Promise<Fill> {
      args.push({ op: "buy", ...a });
      calls.push({ op: "buy", mint: a.mint, amount: a.lamports });
      if (opts.failBuy) throw new Error("blockhash expired https://rpc.example/?api-key=SECRET");
      return { sig: `buy${++n}`, lamports: a.lamports, tokens: a.lamports, decimals: 6 }; // 0.001 SOL per whole token
    },
    async sell(a): Promise<Fill> {
      args.push({ op: "sell", ...a });
      calls.push({ op: "sell", mint: a.mint, amount: a.tokens });
      if (opts.failSell) throw new Error("sell reverted");
      return { sig: `sell${++n}`, lamports: opts.sellLamports ?? 830_000_000n, tokens: opts.sellTokens ?? a.tokens, decimals: 6 };
    },
    async transferSol(a) {
      calls.push({ op: "transfer", mint: a.to, amount: a.lamports });
      return `transfer${++n}`;
    },
    spendable: async () => {
      reads.spendable++;
      return opts.spendable ?? 10n * SOL;
    },
    tokenBalance: async () => opts.ownTokens ?? 0n,
    async burn(a) {
      calls.push({ op: "burn", mint: a.mint, amount: a.tokens });
      return `burn${++n}`;
    },
  };
  return { executor, calls, args, reads };
}

export const staticSource = (id: MarketSource["id"], list: Candidate[] | (() => never)): MarketSource => ({
  id,
  candidates: async () => (typeof list === "function" ? list() : list),
});

export const staticPrices = (map: Record<string, number>): PriceFeed => ({ prices: async (mints) => new Map(mints.filter((m) => m in map).map((m) => [m, map[m]])) });

export const fixedRanker = (scores: Record<string, number>): Ranker & { calls: number } => {
  const r = {
    calls: 0,
    async rank({ candidates }: { candidates: Candidate[] }) {
      r.calls++;
      return new Map(candidates.filter((c) => c.mint in scores).map((c) => [c.mint, { score: scores[c.mint], why: "fits thesis" }]));
    },
  };
  return r;
};

export function deps(over: Partial<TickDeps> & Pick<TickDeps, "repo" | "executor">): TickDeps {
  return {
    sources: {},
    prices: staticPrices({}),
    ranker: fixedRanker({}),
    now: () => 1_791_217_500_000,
    log: silentLog,
    settings: { retryDelayMs: 0 },
    ...over,
  };
}
