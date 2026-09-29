interface SkeletonProps {
  className?: string;
  lines?: number;
}

/** `--panel-2` block with a slow opacity pulse (off under reduced motion). */
function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`h-4 rounded-md bg-panel-2 motion-safe:animate-[skeleton-pulse_1.8s_ease-in-out_infinite] ${className}`}
    />
  );
}

export default function Skeleton({ className = "", lines = 1 }: SkeletonProps) {
  if (lines === 1) {
    return <SkeletonLine className={className} />;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} className={i === lines - 1 ? "w-3/4" : "w-full"} />
      ))}
    </div>
  );
}

export function VSCardSkeleton() {
  return (
    <div className="card space-y-3 p-5">
      <div className="flex justify-between">
        <SkeletonLine className="h-5 w-20" />
        <SkeletonLine className="h-5 w-12" />
      </div>
      <SkeletonLine className="h-6 w-full" />
      <SkeletonLine className="h-6 w-3/4" />
      <div className="flex gap-3">
        <SkeletonLine className="h-16 flex-1" />
        <SkeletonLine className="h-16 flex-1" />
      </div>
    </div>
  );
}

/** Matches the arena claim card layout for loading grids. */
export function ArenaCardSkeleton() {
  return (
    <div className="card relative flex h-full flex-col gap-6 p-6 sm:gap-8 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SkeletonLine className="h-6 w-20" />
        <SkeletonLine className="h-6 w-24" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonLine className="h-7 w-full" />
        <SkeletonLine className="h-7 w-[85%]" />
        <SkeletonLine className="mt-2 h-4 w-full" />
      </div>
      <div className="mt-auto space-y-4 border-t border-line pt-6">
        <SkeletonLine className="h-3 w-28" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex -space-x-2.5">
            <SkeletonLine className="h-8 w-8 rounded-full" />
            <SkeletonLine className="h-8 w-8 rounded-full" />
            <SkeletonLine className="h-8 w-8 rounded-full" />
          </div>
          <SkeletonLine className="h-9 w-32 rounded-full" />
        </div>
      </div>
    </div>
  );
}
