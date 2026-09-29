import type { ReactNode } from "react";

/**
 * Status language.
 * - LiveDot: 7px red dot with an expanding ring (`.dot`), or `pixel` blinking square (`.pxdot`).
 * - StatusPill: 30px glass pill with an optional dot (`.gas-indicator`, `.wallet-chip`).
 * - Pending: red-tinted pill for pending / live states (`.pending`).
 */
export function LiveDot({ pixel = false, className = "" }: { pixel?: boolean; className?: string }) {
  return <span aria-hidden className={`${pixel ? "px-dot" : "live-dot"} ${className}`} />;
}

type Tone = "neutral" | "live" | "win" | "danger";

const dotTone: Record<Tone, string> = {
  neutral: "bg-[#615557]",
  live: "bg-coral shadow-[0_0_7px_rgb(255_81_72/.58)]",
  win: "bg-win",
  danger: "bg-danger",
};

export function StatusPill({
  children,
  tone = "neutral",
  dot = true,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`glass inline-flex min-h-[30px] items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] text-[13px] text-[#b6aaa7] shadow-chip ${className}`}
    >
      {dot ? <span aria-hidden className={`h-[5px] w-[5px] flex-none rounded-full ${dotTone[tone]}`} /> : null}
      {children}
    </span>
  );
}

export function Pending({ children, live = true, className = "" }: { children: ReactNode; live?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-red/[0.14] px-[11px] py-1 text-[12px] text-pending ${className}`}
    >
      {live ? <LiveDot className="!h-1.5 !w-1.5" /> : null}
      {children}
    </span>
  );
}

export default StatusPill;
