// Own-token lock registry: wallet -> mints it may never sell or move (an agent wallet's own token).
// Filled by every worker job that loads an agent before it touches that agent's wallet, and read
// by the executor/submitter for every transaction that wallet signs. Process memory on purpose:
// the executor also checks pump.fun's on-chain curve creator, which needs no registry at all.
const locks = new Map<string, Set<string>>();

export function lockOwnMint(wallet: string, mint: string | null | undefined): void {
  if (!mint) return;
  const set = locks.get(wallet) ?? new Set<string>();
  set.add(mint);
  locks.set(wallet, set);
}

export const lockedMintsOf = (wallet: string): string[] => [...(locks.get(wallet) ?? [])];
