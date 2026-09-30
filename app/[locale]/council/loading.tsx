import { Skeleton } from "@/components/ui";

/** Shown while the council's stakes and bankrolls are read on a cold cache: the page's shape, no text. */
export default function CouncilLoading() {
  return (
    <div className="grid gap-6 sm:gap-8" aria-busy="true" role="status" aria-label="Loading the council">
      <div className="grid gap-3">
        <Skeleton className="h-10 w-44" />
        <Skeleton className="w-full max-w-[520px]" />
      </div>
      <Skeleton className="h-[74px] rounded-2xl" />
      <Skeleton className="h-[112px] rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[168px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
