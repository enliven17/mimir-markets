import type { ReactNode } from "react";

/**
 * Dashed glass box with one line and at most one action.
 * `SlotPlaceholder` is the card-sized dashed box
 * for a missing item in a rail.
 */
export default function EmptyState({
  children,
  action,
  className = "",
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto grid min-h-[154px] w-full max-w-[320px] place-content-center gap-3 rounded-3xl border border-dashed border-[rgb(235_220_216/.28)] bg-[rgb(12_8_9/.52)] px-6 py-[18px] text-center text-[15px] text-cream shadow-[inset_0_1px_3px_rgb(255_255_255/.05),inset_0_-2px_5px_rgb(0_0_0/.3),0_14px_36px_rgb(0_0_0/.22)] ${className}`}
    >
      <p className="m-0">{children}</p>
      {action ? <div className="flex justify-center">{action}</div> : null}
    </div>
  );
}

export function SlotPlaceholder({ className = "", label }: { className?: string; label?: string }) {
  return (
    <div
      aria-hidden={label ? undefined : true}
      className={`grid min-h-[160px] place-items-center rounded-2xl border border-dashed border-[rgb(235_220_216/.25)] text-[13px] text-muted ${className}`}
    >
      {label}
    </div>
  );
}
