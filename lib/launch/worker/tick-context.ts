// Dependencies of one agent tick, plus the two helpers every step uses: `emit` (live-view event,
// never throws) and `persist` (DB write after an on-chain action, retried; on final failure the
// agent is paused and a RECONCILE error is emitted with the signature).
import type { DataSource } from "../types";
import type { AgentRow, Candidate, EventKind, Executor, MarketSource, PriceFeed, Ranker, Repo } from "../ports";
import type { Log } from "./log";
import { publicError } from "./log";

export type TickSettings = {
  /** Minimum LLM score to enter (default 0.6). */
  threshold?: number;
  /** Max simultaneously open positions (default 3). */
  maxOpen?: number;
  minTradeLamports?: bigint;
  /** Max candidates sent to the ranker (default 15). */
  maxRanked?: number;
  /** Delay between persist retries, ms (default 250). */
  retryDelayMs?: number;
  /** Shutdown sweep: a holders pool at least this big stays for a last airdrop (default 0.1 SOL). */
  holdersMinLamports?: bigint;
};

export type TickDeps = {
  repo: Repo;
  executor: Executor;
  sources: Partial<Record<DataSource, MarketSource>>;
  prices: PriceFeed;
  ranker: Ranker;
  /** Fills missing metrics (liquidity, price…) for candidates from sparse sources. */
  enrich?: (candidates: Candidate[]) => Promise<Candidate[]>;
  now: () => number;
  log: Log;
  settings?: TickSettings;
  /**
   * Copy trading: hand the agent's fill to its followers (worker/copy.ts schedules one job per follower, keyed on
   * the agent's signature so a retried tick never copies twice). Optional; never throws.
   */
  mirror?: { buy(agentId: string, mint: string, slippageBps: number, sig: string, reference?: { price: number; at: number }): Promise<void>; sell(agentId: string, mint: string, fraction: number, slippageBps: number, sig: string): Promise<void> };
};

export type TickContext = {
  agent: AgentRow;
  deps: TickDeps;
  emit(kind: EventKind, text: string): Promise<void>;
  persist(what: string, sig: string, write: () => Promise<unknown>): Promise<void>;
  /** Set when a DB write after a trade failed: stop trading this tick. */
  halted: boolean;
};

export class PersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createContext(agent: AgentRow, deps: TickDeps): TickContext {
  const ctx: TickContext = {
    agent,
    deps,
    halted: false,
    async emit(kind, text) {
      try {
        await deps.repo.logEvent(agent.id, kind, text.slice(0, 500));
      } catch (err) {
        deps.log.warn("logEvent failed", { agentId: agent.id, kind, text, err });
      }
    },
    async persist(what, sig, write) {
      const attempts = 3;
      for (let i = 1; i <= attempts; i++) {
        try {
          await write();
          return;
        } catch (err) {
          deps.log.error("persist failed", { agentId: agent.id, what, sig, attempt: i, err });
          if (i < attempts) await sleep((deps.settings?.retryDelayMs ?? 250) * i);
          else {
            ctx.halted = true;
            await ctx.emit("error", `RECONCILE: ${what} landed on-chain (sig ${sig}) but was not recorded: ${publicError(err)}. Agent paused.`);
            await deps.repo.setStatus(agent.id, "paused").catch((e) => deps.log.error("pause after persist failure failed", { agentId: agent.id, err: e }));
            throw new PersistError(`${what} not recorded (sig ${sig})`);
          }
        }
      }
    },
  };
  return ctx;
}
