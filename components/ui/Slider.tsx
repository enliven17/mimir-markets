"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

/**
 * Range input in radio's look (`.slider`): 4px `--panel-2` rail, coral fill
 * up to the thumb, 16px cream thumb. Native `<input type="range">`, so
 * keyboard and screen readers work as usual.
 */
const Slider = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max"> & {
    value: number;
    min?: number;
    max?: number;
  }
>(function Slider({ value, min = 0, max = 100, className = "", style, ...props }, ref) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      value={value}
      className={`slider ${className}`}
      style={{ ...style, "--fill": `${Math.max(0, Math.min(100, pct))}%` } as React.CSSProperties}
      {...props}
    />
  );
});

export default Slider;
