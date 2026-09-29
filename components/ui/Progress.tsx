import type { ReactNode } from "react";

/**
 * Step progress (radio `.progress`): equal segments with a 3px bar, done
 * segments turn coral. `current` is the 0-based index of the active step;
 * every step up to and including it counts as done.
 */
export default function Progress({
  steps,
  current,
  label,
  className = "",
}: {
  steps: ReactNode[];
  current: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`progress-steps ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={Math.min(steps.length, Math.max(0, current + 1))}
    >
      {steps.map((s, i) => (
        <span key={i} data-done={i <= current ? "true" : undefined}>
          {s}
        </span>
      ))}
    </div>
  );
}

/** Single 3px meter (radio `.dial-meter`), value 0..1. */
export function Meter({ value, className = "" }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`h-[3px] overflow-hidden rounded-[3px] bg-panel-2 ${className}`} aria-hidden>
      <i
        className="block h-full origin-left bg-coral transition-transform duration-300 ease-out"
        style={{ transform: `scaleX(${v})` }}
      />
    </div>
  );
}
