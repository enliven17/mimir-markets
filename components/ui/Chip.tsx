"use client";

import type { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  active?: boolean;
  color?: string;
  onClick?: () => void;
  className?: string;
  /** Overrides the `aria-pressed` derived from `active` (e.g. URL filters). */
  "aria-pressed"?: boolean;
}

/**
 * Toggle chip: 30px glass pill.
 * Active = cream fill with ink label, like the segmented thumb.
 */
export default function Chip({
  children,
  active = false,
  color,
  onClick,
  className = "",
  "aria-pressed": ariaPressedProp,
}: ChipProps) {
  const dynamicStyle = color && active ? { color, boxShadow: `inset 0 0 0 1px ${color}66` } : {};
  const ariaPressed = ariaPressedProp ?? active;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      className={`chip press whitespace-nowrap ${
        active && !color ? "!bg-cream text-ink" : "text-muted hover:text-cream"
      } ${className}`}
      style={dynamicStyle}
    >
      {children}
    </button>
  );
}
