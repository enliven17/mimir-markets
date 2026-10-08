"use client";

import { useEffect, useRef } from "react";

import { usePathname } from "@/i18n/navigation";

/**
 * Page width container: 1180px for feeds, 920px for
 * detail and forms, with the shared gutter, clearing the floating pill.
 * The landing `/` is full bleed: its sections set their own width and the
 * hero runs under the docked bar. Each new page slides in (`route-in` in
 * app/globals.css); the frame itself stays mounted, so nothing inside it
 * (the invite gate, live queries) restarts on navigation.
 */
export default function PageFrame({
  children,
  width = "wrap",
}: {
  children: React.ReactNode;
  width?: "wrap" | "narrow";
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("route-in");
    void el.offsetWidth; // restart the animation
    el.classList.add("route-in");
  }, [pathname]);

  if (pathname === "/") return <div className="w-full min-w-0">{children}</div>;
  return (
    <div
      ref={ref}
      className={`mx-auto w-full min-w-0 px-[var(--gut)] pb-10 pt-[calc(76px+var(--safe-top)+var(--top-banner))] lg:pt-[calc(92px+var(--safe-top)+var(--top-banner))] ${
        width === "narrow" ? "max-w-[calc(var(--wrap-narrow)+2*var(--gut))]" : "max-w-[calc(var(--wrap)+2*var(--gut))]"
      }`}
    >
      {children}
    </div>
  );
}
