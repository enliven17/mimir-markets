"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, reducedMotion } from "@/lib/motion";

interface LiveStatProps {
  /** The target number to display */
  value: number;
  /** Format the displayed number */
  format?: (n: number) => string;
  /** Label text above or below the number */
  label?: string;
  /** Label position */
  labelPosition?: "above" | "below";
  /** Prefix (e.g. "$", "Ξ") */
  prefix?: string;
  /** Suffix (e.g. "USDC", "%") */
  suffix?: string;
  /** Duration of the roll animation in seconds */
  duration?: number;
  /** Text size class */
  size?: "sm" | "md" | "lg" | "xl";
  /** Accent color for the number */
  color?: "text" | "cyan" | "fuch" | "emerald" | "gold";
  /** Optional override for the label typography */
  labelClassName?: string;
  className?: string;
}

const sizeClasses = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-3xl sm:text-4xl",
  xl: "text-4xl sm:text-5xl",
};

const colorClasses = {
  text: "text-pv-text",
  cyan: "text-pv-cyan",
  fuch: "text-pv-fuch",
  emerald: "text-pv-emerald",
  gold: "text-pv-gold",
};

/**
 * LiveStat — number display that rolls to new values and pulses briefly
 * when the value updates (GSAP; snaps under reduced motion).
 */
export default function LiveStat({
  value,
  format,
  label,
  labelPosition = "above",
  prefix,
  suffix,
  duration = 1.2,
  size = "md",
  color = "text",
  labelClassName = "",
  className = "",
}: LiveStatProps) {
  const formatter = format ?? ((n: number) => Math.round(n).toLocaleString());
  const [displayValue, setDisplayValue] = useState(() => formatter(value));
  const numRef = useRef<HTMLDivElement>(null);
  const shown = useRef({ v: 0 });
  const hasAnimated = useRef(false);

  useEffect(() => {
    const isFirst = !hasAnimated.current;
    hasAnimated.current = true;
    const from = shown.current.v;
    // First paint shows the real value (SSR-safe); later updates roll.
    if (isFirst || reducedMotion()) {
      shown.current.v = value;
      setDisplayValue(formatter(value));
      return;
    }
    const tween = gsap.fromTo(
      shown.current,
      { v: from },
      {
        v: value,
        duration,
        ease: "power2.out",
        onUpdate: () => setDisplayValue(formatter(shown.current.v)),
      },
    );
    let pulse: gsap.core.Tween | undefined;
    if (from !== value && numRef.current) {
      pulse = gsap.fromTo(
        numRef.current,
        { scale: 1.06, opacity: 0.8 },
        { scale: 1, opacity: 1, duration: 0.4, ease: "power2.out", clearProps: "transform,opacity" },
      );
    }
    return () => {
      tween.kill();
      pulse?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <div className={`flex flex-col ${className}`}>
      {label && labelPosition === "above" && (
        <span
          className={`font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-pv-muted/60 mb-1 ${labelClassName}`}
        >
          {label}
        </span>
      )}

      <div
        ref={numRef}
        className={`font-mono tabular-nums ${sizeClasses[size]} ${colorClasses[color]}`}
      >
        {prefix && <span className="text-pv-muted/50">{prefix}</span>}
        {displayValue}
        {suffix && (
          <span className="text-[0.6em] ml-1 text-pv-muted/60 font-mono font-normal">
            {suffix}
          </span>
        )}
      </div>

      {label && labelPosition === "below" && (
        <span
          className={`font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-pv-muted/60 mt-1 ${labelClassName}`}
        >
          {label}
        </span>
      )}
    </div>
  );
}
