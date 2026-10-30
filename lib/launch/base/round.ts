/**
 * One round of a Base agent's own upkeep (convex/launchBase.ts runs it per agent): its Clanker creator fees into its
 * wallet hourly, where they become bankroll the owner can withdraw (as Pons fees do on Robinhood Chain); and on
 * shutdown, one last claim then all spendable ETH back to the owner's payout address, after which it is swept.
 * Pure: chain and storage are injected (tests/node/base-clanker.test.ts).
 */
export const BASE_CLAIM_EVERY_MS = 60 * 60_000;
/** Below this (gwei) a shutdown sweep sends nothing: not worth the gas. */
export const BASE_SWEEP_MIN_GWEI = 10_000n; // 0.00001 ETH

export type BaseAgent = { id: string; ticker: string; walletId: string; wallet: string; payout: string; mint: string | null; status: "pending" | "live" | "paused" | "killed"; feesClaimedAt: number | null; swept: boolean };

export type BaseRoundDeps = {
  claim: (a: { walletId: string; wallet: string }) => Promise<{ sig: string; wei: bigint } | null>;
  spendable: (wallet: string) => Promise<bigint>;
  transfer: (a: { walletId: string; wallet: string; to: string; gwei: bigint }) => Promise<string>;
  markClaimed: (id: string) => Promise<void>;
  markSwept: (id: string) => Promise<void>;
  log: (id: string, kind: "rules" | "error", text: string, tx?: string) => Promise<void>;
};

/** Whether the cron should run a round for it: a launched token with a claim due, or a shutdown not yet swept. */
export function baseRoundDue(a: Pick<BaseAgent, "mint" | "status" | "feesClaimedAt" | "swept">, now: number): boolean {
  if (!a.mint) return false;
  if (a.status === "killed") return !a.swept;
  return now - (a.feesClaimedAt ?? 0) > BASE_CLAIM_EVERY_MS;
}

const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);

export async function baseRound(a: BaseAgent, d: BaseRoundDeps, now = Date.now()): Promise<{ claimedWei: bigint; sweptGwei: bigint }> {
  let claimedWei = 0n;
  let sweptGwei = 0n;
  if (!baseRoundDue(a, now)) return { claimedWei, sweptGwei };
  try {
    // Marked first: a failing claim must not be retried every minute.
    await d.markClaimed(a.id);
    const c = await d.claim({ walletId: a.walletId, wallet: a.wallet });
    if (c) {
      claimedWei = c.wei;
      await d.log(a.id, "rules", `claimed ${eth(c.wei)} ETH of $${a.ticker} creator fees on Clanker`, c.sig);
    }
  } catch (err) {
    // On shutdown the sweep still goes: what stays in the fee locker can be claimed to the wallet and withdrawn later.
    await d.log(a.id, "error", `creator fee claim failed: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
  }
  if (a.status !== "killed") return { claimedWei, sweptGwei };
  const gwei = await d.spendable(a.wallet);
  if (gwei > BASE_SWEEP_MIN_GWEI) {
    const tx = await d.transfer({ walletId: a.walletId, wallet: a.wallet, to: a.payout, gwei });
    sweptGwei = gwei;
    await d.log(a.id, "rules", `returned ${(Number(gwei) / 1e9).toFixed(6)} ETH on Base to the owner`, tx);
  }
  await d.markSwept(a.id);
  return { claimedWei, sweptGwei };
}
