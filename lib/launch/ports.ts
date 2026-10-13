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
