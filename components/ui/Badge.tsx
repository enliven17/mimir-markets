"use client";

import { useTranslations } from "next-intl";

interface BadgeProps {
  status: string;
  large?: boolean;
  compact?: boolean;
}

/**
 * Claim status pill in radio's tones: open/live read as the red `pending`
 * pill, settled/won as `win`, losses as `danger`, the rest muted on glass.
 */
const STATUS_CLASSES: Record<string, string> = {
  open: "bg-red/[0.14] text-pending",
  accepted: "bg-red/[0.14] text-pending",
  resolved: "bg-cream/[0.07] text-cream",
  won: "bg-win/[0.1] text-win",
  lost: "bg-danger/[0.1] text-danger",
  draw: "bg-cream/[0.06] text-muted",
  cancelled: "bg-cream/[0.04] text-muted",
};

export default function Badge({ status, large = false, compact = false }: BadgeProps) {
  const t = useTranslations("badges");
  const classes = STATUS_CLASSES[status] ?? STATUS_CLASSES.draw;
  const label = t(status as any);

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full ${classes} ${
        compact ? "px-2 py-0.5 text-[11px]" : large ? "px-3.5 py-1.5 text-[13px]" : "px-[11px] py-1 text-[12px]"
      }`}
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: "currentColor" }} />
      {label}
    </span>
  );
}
