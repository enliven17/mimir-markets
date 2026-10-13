/** Mimir Launch: what the engine needs from the outside world (ported from snipad lib/server/ports.ts). */
import type { Condition, DataSource } from "./types";

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

