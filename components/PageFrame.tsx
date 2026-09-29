"use client";

import { usePathname } from "@/i18n/navigation";

/**
 * Page width container: 1180px for feeds, 920px for
 * detail and forms, with the shared gutter, clearing the floating pill.
 * The landing `/` is full bleed: its sections set their own width and the
 * hero runs under the docked bar.
 */
export default function PageFrame({
  children,
  width = "wrap",
}: {
  children: React.ReactNode;
  width?: "wrap" | "narrow";
}) {
  const isHome = usePathname() === "/";
  if (isHome) return <div className="w-full min-w-0">{children}</div>;
  return (
    <div
      className={`bp-page mx-auto w-full min-w-0 px-[var(--gut)] pb-10 pt-[calc(92px+env(safe-area-inset-top))] ${
        width === "narrow" ? "max-w-[calc(var(--wrap-narrow)+2*var(--gut))]" : "max-w-[calc(var(--wrap)+2*var(--gut))]"
      }`}
    >
      {children}
    </div>
  );
}
