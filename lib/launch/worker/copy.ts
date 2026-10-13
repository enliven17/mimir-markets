/**
 * Mimir Launch copy trading (ported from snipad worker/copy.ts). A follower picks what to copy: the agent's Solana
 * trades, its Arc market stakes, or both. Each side runs from a wallet of the follower's own subscription:
 *   Solana  a Privy copy wallet locked to trading + SOL back to the follower. When the agent buys, it buys the same
 *           token (capped by the follower's max per trade and what the wallet holds); when the agent sells a fraction
 *           of a position, it sells the same fraction of its own.
 *   Arc     a Circle copy wallet. When the agent stakes on a pool, it stakes the same side (capped by the follower's
 *           max per stake, keeping a gas reserve).
 * Holding $MIMIR is a condition of USING copy trading: checked before every mirrored entry; a follower who stopped
 * holding is paused (no new entries; what they hold still exits with the agent). A follower's failure is logged and
 * never touches the agent or other followers. Runtime-agnostic: persistence goes through CopyStore.
 */
import type { Fill, TradeArgs } from "../ports";
import type { Log } from "./log";

/** A follower's copy buy never takes more slippage than this, whatever the agent uses. */
export const COPY_MAX_SLIPPAGE_BPS = 300;
const MIN_COPY_LAMPORTS = 10_000_000n; // 0.01 SOL
/** Left in an Arc copy wallet for its own gas. */
export const COPY_GAS_RESERVE_USDC = 0.05;

type SolExec = {
  buy(a: TradeArgs & { lamports: bigint }): Promise<Fill>;
  sell(a: TradeArgs & { tokens: bigint }): Promise<Fill>;
  spendable(wallet: string): Promise<bigint>;
};

export type SolSub = { id: string; follower: string; walletId: string; wallet: string; maxPerTradeLamports: bigint };
export type HeldSub = { id: string; walletId: string; wallet: string; tokens: bigint };
export type ArcSub = { id: string; follower: string; walletId: string; wallet: string; maxPerStakeUsdc: number };

export type CopyStore = {
  /** Active subscriptions copying the agent's Solana trades. */
  solSubs(agentId: string): Promise<SolSub[]>;
  /** Every subscription (active or not) of the agent holding `mint`: paused followers still exit. */
  holders(agentId: string, mint: string): Promise<HeldSub[]>;
  addPosition(subId: string, mint: string, tokens: bigint, costLamports: bigint): Promise<void>;
  /** After selling: `left` of `held` remains; the row goes at 0. */
  settleSell(subId: string, mint: string, held: bigint, left: bigint): Promise<void>;
  pauseForGate(subId: string): Promise<void>;
};

/** Does the follower hold $MIMIR? Must fail closed (false) on errors. */
export type HoldsCheck = (follower: string) => Promise<boolean>;

export function createMirror(store: CopyStore, executor: SolExec, log: Log, holds: HoldsCheck) {
  return {
    async buy(agentId: string, mint: string, slippageBps: number) {
      let subs: SolSub[] = [];
      try {
        subs = await store.solSubs(agentId);
      } catch (err) {
        log.warn("copy subs read failed", { agentId, err });
      }
      for (const s of subs) {
        try {
          if (!(await holds(s.follower))) {
            await store.pauseForGate(s.id);
            log.info("copy paused: follower no longer holds $MIMIR", { agentId, subId: s.id });
            continue;
          }
          const have = await executor.spendable(s.wallet);
          const lamports = have < s.maxPerTradeLamports ? have : s.maxPerTradeLamports;
          if (lamports < MIN_COPY_LAMPORTS) continue;
          const fill = await executor.buy({ walletId: s.walletId, wallet: s.wallet, mint, lamports, slippageBps: Math.min(slippageBps, COPY_MAX_SLIPPAGE_BPS) });
          await store.addPosition(s.id, mint, fill.tokens, fill.lamports);
        } catch (err) {
          log.warn("copy buy failed", { agentId, subId: s.id, mint, err });
        }
      }
    },

    /** `fraction` of each follower's holding in `mint` (>= 1 sells it all). */
    async sell(agentId: string, mint: string, fraction: number, slippageBps: number) {
      let rows: HeldSub[] = [];
      try {
        rows = await store.holders(agentId, mint);
      } catch (err) {
        log.warn("copy holders read failed", { agentId, err });
      }
      for (const r of rows) {
        try {
          const bps = BigInt(Math.min(10_000, Math.max(0, Math.floor(fraction * 10_000))));
          const tokens = fraction >= 1 ? r.tokens : (r.tokens * bps) / 10_000n;
          if (tokens <= 0n) continue;
          const fill = await executor.sell({ walletId: r.walletId, wallet: r.wallet, mint, tokens, slippageBps });
          await store.settleSell(r.id, mint, r.tokens, r.tokens - fill.tokens);
        } catch (err) {
          log.warn("copy sell failed", { agentId, subId: r.id, mint, err });
        }
      }
    },
  };
}
export type Mirror = ReturnType<typeof createMirror>;

/** The stake each Arc follower places: its cap, within its balance minus the gas reserve, in cents; 0 = skip. */
export function arcCopyAmount(capUsdc: number, balanceUsdc: number, minStakeUsdc: number): number {
  const amount = Math.floor(Math.min(capUsdc, balanceUsdc - COPY_GAS_RESERVE_USDC) * 100) / 100;
  return amount >= minStakeUsdc ? amount : 0;
}

export type ArcCopyDeps = {
  subs(): Promise<ArcSub[]>;
  pauseForGate(subId: string): Promise<void>;
  balanceUsdc(wallet: string): Promise<number>;
  /** Stakes `amountUsdc` on pool `marketId`, side `side`, from the copy wallet; returns the tx hash. */
  stake(a: { walletId: string; marketId: number; side: number; amountUsdc: number }): Promise<string>;
  holds: HoldsCheck;
  log: Log;
  minStakeUsdc: number;
};

/** Mirrors one agent stake on a pool into every active Arc follower. Never throws. Returns how many copied. */
export async function mirrorArcStake(d: ArcCopyDeps, market: { kind: "vs" | "pool"; marketId: number }, side: number): Promise<number> {
  // Pools only: a VS market's challenger side has a capped room the copies would have to share.
  if (market.kind !== "pool") return 0;
  let subs: ArcSub[] = [];
  try {
    subs = await d.subs();
  } catch (err) {
    d.log.warn("arc copy subs read failed", { err });
    return 0;
  }
  let n = 0;
  for (const s of subs) {
    try {
      if (!(await d.holds(s.follower))) {
        await d.pauseForGate(s.id);
        continue;
      }
      const amount = arcCopyAmount(s.maxPerStakeUsdc, await d.balanceUsdc(s.wallet), d.minStakeUsdc);
      if (!amount) continue;
      await d.stake({ walletId: s.walletId, marketId: market.marketId, side, amountUsdc: amount });
      n++;
    } catch (err) {
      d.log.warn("arc copy stake failed", { subId: s.id, marketId: market.marketId, err });
    }
  }
  return n;
}
