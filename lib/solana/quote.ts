import { challengerGross, splitFees } from "./fees";
import type { Quote } from "../arc/markets";

const SCALE = 1_000_000_000_000n;
/** Match the SPL program's 6-decimal rounding and profit-only fee, exactly. */
export function solanaChallengeQuote(m: { stakeA: string; stakeB: string; platformFeeBps?: number; agentFeeBps?: number; feeRecipient?: string }, stake: bigint, wallet: string | null): Quote {
  const principal = stake / SCALE;
  const gross = challengerGross(2, principal, BigInt(m.stakeA) / SCALE, BigInt(m.stakeB) / SCALE + principal)!;
  const fee = splitFees({ ...gross, winner: wallet ?? "unconnected", agentOwner: null,
    policy: { platformFeeBps: m.platformFeeBps ?? 50, agentOwnerFeeBps: m.agentFeeBps ?? 50, platformRecipient: m.feeRecipient ?? "platform" } });
  return { risk: stake, fee: fee.totalFees * SCALE, win: fee.netPayout * SCALE, atMost: true };
}
