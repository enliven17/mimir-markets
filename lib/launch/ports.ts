/** Mimir Launch: what the engine needs from the outside world (ported from snipad lib/server/ports.ts). */
import type { Condition, DataSource, RiskParams, StrategyConfig } from "./types";
import type { IdleState } from "./worker/idle";

/** One LLM call for the ranker; the router behind it is Mimir's (lib/llm.ts) or the owner's own key. */
export type CompleteOptions = { system: string; user: string; json?: boolean; maxTokens?: number; temperature?: number };
export type JsonCompletion<T> = { data: T; provider: string; model: string };

export interface Candidate {
  mint: string;
  symbol: string;
  name?: string;
  source: DataSource;
  priceSol: number | null;
  metrics: Partial<Record<Condition["metric"], number>>;
  /** Free text for the LLM: why the source surfaced it (e.g. "wallet 7xKp… bought 4 SOL"). */
  note?: string;
  /** Creator wallet when the source knows it (pump.fun launches). */
  creator?: string;
}

export interface Ranker {
  /** 0..1 per candidate mint; candidates it drops get no entry. Must not throw (return empty map). */
  rank(a: { thesis: string; candidates: Candidate[] }): Promise<Map<string, { score: number; why: string }>>;
}

// ---------- execution (Solana) ----------

export interface Fill {
  sig: string;
  lamports: bigint; // SOL spent (buy) or received (sell)
  tokens: bigint;   // tokens received (buy) or sold (sell)
  decimals: number;
}

/** Trades from one wallet. Implementations pick pump.fun curve or Jupiter by the token's state. */
/**
 * ownMint: the agent's own token as stored on the agent record (never inferred from chain data: anyone
 * can launch a coin naming any wallet as creator). It may never be sold; a buy of it is the buyback.
 */
export type TradeArgs = {
  walletId: string; wallet: string; mint: string; slippageBps: number; ownMint?: string | null;
  /** Mints of the wallet's other open positions: the simulation refuses a tx that lowers them. */
  protect?: readonly string[];
};

export interface Executor {
  buy(a: TradeArgs & { lamports: bigint }): Promise<Fill>;
  sell(a: TradeArgs & { tokens: bigint }): Promise<Fill>;
  /** Send SOL out; the wallet's policy only allows the creator and the treasury. Returns the sig. */
  transferSol(a: { walletId: string; wallet: string; to: string; lamports: bigint; onSigned?: (sig: string, lastValidBlockHeight: number) => Promise<void> }): Promise<string>;
  /** Spendable SOL in the wallet, lamports, after the reserve for fees and rent. */
  spendable(wallet: string): Promise<bigint>;
  /** Raw balance of `mint` held by `wallet` (kill: what is left of the own token). */
  tokenBalance?(wallet: string, mint: string): Promise<bigint>;
  /** Burns tokens from the wallet (the only way its own token may leave). Returns the sig. */
  burn?(a: { walletId: string; wallet: string; mint: string; tokens: bigint }): Promise<string>;
}


// ---------- the trading worker (lib/launch/worker) ----------

/** A source of candidates. `ctx.whales` for helius; adapters must not throw on network errors (return []). */
export interface MarketSource {
  id: DataSource;
  candidates(ctx: { whales: string[]; signal?: AbortSignal }): Promise<Candidate[]>;
}

export interface PriceFeed {
  /** SOL per whole token for each mint it knows; missing = unknown. */
  prices(mints: string[]): Promise<Map<string, number>>;
}

/** What the worker reads of an agent (convex/launchSolDb.ts). Units: lamports and raw token units are bigint. */
export interface AgentRow {
  id: string;
  name: string;
  ticker: string;
  /** Its own pump.fun token: never sold, never a candidate. */
  mint: string | null;
  /** Where a kill sweeps the SOL. */
  owner: string;
  walletId: string;
  wallet: string;
  status: "pending" | "live" | "paused" | "killed";
  config: StrategyConfig;
  risk: RiskParams;
  createdAt: Date;
  idle?: IdleState;
  /** Lamports in the wallet that are owed (fee pools, payouts in flight, owed treasury): never traded or swept. */
  reservedLamports?: bigint;
}

export interface PositionRow {
  id: string;
  agentId: string;
  mint: string;
  symbol: string;
  tokens: bigint;
  decimals: number;
  costLamports: bigint;
  entryPrice: number;
  highPrice: number;
  openedAt: Date;
}

export type EventKind = "scan" | "score" | "rules" | "buy" | "sell" | "hold" | "error" | "burn";
export type SellRecord = { lamports: bigint; tokens: bigint; reason: string; sig: string };

export interface Repo {
  agent(id: string): Promise<AgentRow | null>;
  openPositions(agentId: string): Promise<PositionRow[]>;
  /** Idempotent on the buy sig: a persist retried after a timeout never double-books a fill. */
  openPosition(p: Omit<PositionRow, "id" | "openedAt">, buy: { lamports: bigint; reason: string; sig: string }): Promise<PositionRow>;
  closePosition(positionId: string, sell: SellRecord): Promise<void>;
  /** Partial sell keeps the position open with fewer tokens. */
  reducePosition(positionId: string, sell: SellRecord): Promise<void>;
  setHighPrice(positionId: string, price: number): Promise<void>;
  /** Realised PnL since UTC midnight, lamports. */
  dailyPnl(agentId: string): Promise<bigint>;
  logEvent(agentId: string, kind: EventKind, text: string): Promise<void>;
  setStatus(agentId: string, status: AgentRow["status"]): Promise<void>;
  /** Killed agent's bankroll went back to the owner; stop ticking it. */
  markSwept(agentId: string): Promise<void>;
  /** Idle counter / sleep state (null = awake). */
  setIdle(agentId: string, s: Omit<IdleState, "wakeRequestedAt"> | null): Promise<void>;
  /**
   * Shutdown: the creator pool goes with the sweep, a holders pool of at least `holdersMinLamports` stays for a final
   * airdrop. Returns what must stay in the wallet. Absent = nothing is reserved (no fee flow).
   */
  closeOutPools?(agentId: string, holdersMinLamports: bigint): Promise<bigint>;
}
