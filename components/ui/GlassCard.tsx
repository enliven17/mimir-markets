import type { HTMLAttributes, ReactNode } from "react";

type GlowSide = "cyan" | "fuch" | "both" | "emerald" | "none";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  glow?: GlowSide;
  hoverable?: boolean;
  noPad?: boolean;
  glass?: boolean;
}

const glowStyles: Record<GlowSide, ReactNode> = {
  cyan: <div className="glow-cyan pointer-events-none absolute left-0 top-0 h-full w-3/5" />,
  fuch: <div className="glow-fuch pointer-events-none absolute right-0 top-0 h-full w-3/5" />,
  both: (
    <>
      <div className="glow-cyan pointer-events-none absolute left-0 top-0 h-full w-1/2" />
      <div className="glow-fuch pointer-events-none absolute right-0 top-0 h-full w-1/2" />
    </>
  ),
  emerald: <div className="glow-emerald pointer-events-none absolute inset-0" />,
  none: null,
};

/**
 * @deprecated Use `Card` from `components/ui/Card`. Kept so existing pages
 * compile; now a plain glass card.
 */
export default function GlassCard({
  children,
  glow = "none",
  hoverable = false,
  noPad = false,
  glass: _glass = false,
  className = "",
  ...props
}: GlassCardProps) {
  return (
    <div className={`card ${hoverable ? "card-hover" : ""} ${className}`} {...props}>
      {glowStyles[glow]}
      <div className={`relative ${noPad ? "" : "p-6"}`}>{children}</div>
    </div>
  );
}
