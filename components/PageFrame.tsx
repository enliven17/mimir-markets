"use client";

import { usePathname } from "@/i18n/navigation";

/**
 * Page width container (docs/REDESIGN.md 1.7): 1180px for feeds, 920px for
 * detail and forms, with the shared gutter. Clears the fixed header: the
 * docked bar on `/`, the floating pill everywhere else.
 */
export default function PageFrame({
  children,
  width = "wrap",
}: {
  children: React.ReactNode;
  width?: "wrap" | "narrow";
}) {
  const isHome = usePathname() === "/";
  return (
    <div
      className={`bp-page mx-auto w-full min-w-0 px-[var(--gut)] ${
        width === "narrow" ? "max-w-[calc(var(--wrap-narrow)+2*var(--gut))]" : "max-w-[calc(var(--wrap)+2*var(--gut))]"
      } ${isHome ? "pt-[calc(64px+env(safe-area-inset-top))]" : "pb-10 pt-[calc(92px+env(safe-area-inset-top))]"}`}
    >
      {children}
    </div>
  );
}
