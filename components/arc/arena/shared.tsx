"use client";

/** Small pieces shared by the Arc feed, market page and create form. */
import type { Doc } from "@/convex/_generated/dataModel";
import { LOCK_SECONDS, weiToUsd } from "@/lib/arc/markets";

export type ArcMarket = Doc<"arcMarkets">;
export type ArcPhase = "open" | "awaiting" | "proposed" | "disputed" | "resolved" | "cancelled";

export const BTN_PRIMARY = "rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60";
export const BTN_SECONDARY = "press rounded-full bg-panel-raised px-5 py-2.5 text-[14px] text-cream disabled:opacity-60";

/** What the viewer can do now: betting closes LOCK_SECONDS before the deadline, then the oracle takes over. */
export function arcPhase(m: Pick<ArcMarket, "status" | "deadline">, now: number): ArcPhase {
  if (m.status === "open" || m.status === "active") return now + LOCK_SECONDS <= m.deadline ? "open" : "awaiting";
  return m.status;
}

export const PHASE_LABEL: Record<ArcPhase, string> = {
  open: "Open",
  awaiting: "Awaiting result",
  proposed: "Result proposed",
  disputed: "Disputed",
  resolved: "Settled",
  cancelled: "Refunded",
};

export const PHASE_DOT: Record<ArcPhase, string> = {
  open: "bg-coral shadow-[0_0_7px_rgb(255_81_72/.58)]",
  awaiting: "bg-pending",
  proposed: "bg-pending",
  disputed: "bg-danger",
  resolved: "bg-win",
  cancelled: "bg-[#615557]",
};

export const KIND_LABEL = { vs: "VS", pool: "Pool" } as const;

export const usd = (wei: bigint | string) =>
  `$${weiToUsd(wei).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Small amounts (fees) to the tenth of a cent. */
export const usdFine = (wei: bigint | string) =>
  `$${weiToUsd(wei).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/** Side A's share of the money, 0..100; null when one side is still empty (no price yet). */
export function shareA(m: Pick<ArcMarket, "stakeA" | "stakeB">): number | null {
  const a = BigInt(m.stakeA);
  const b = BigInt(m.stakeB);
  if (a === 0n || b === 0n) return null;
  return Number((a * 10_000n) / (a + b)) / 100;
}

/** The two-colour split: cream = side A, coral = side B; hatched until both sides have money. */
export function Split({ m, className = "h-[5px]" }: { m: Pick<ArcMarket, "stakeA" | "stakeB">; className?: string }) {
  const a = shareA(m);
  return (
    <div
      className={`relative overflow-hidden rounded-full ${a === null ? "bg-[repeating-linear-gradient(135deg,rgb(243_234_214/.18)_0_4px,transparent_4px_8px)]" : "bg-coral"} ${className}`}
    >
      {a !== null ? <div className="absolute inset-y-0 left-0 bg-cream transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${a}%` }} /> : null}
    </div>
  );
}
