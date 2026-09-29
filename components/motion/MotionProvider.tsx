"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  REDUCED_MOTION_QUERY,
  ScrollTrigger,
  getLenis,
  scrollToHash,
  startSmoothScroll,
  stopSmoothScroll,
} from "@/lib/motion";

/**
 * Mounted once in the root layout. Starts the single Lenis instance (off under
 * reduced motion, and torn down if the setting flips while the page is open),
 * pauses it while the tab is hidden, routes in-page anchor clicks through
 * Lenis, and refreshes ScrollTrigger once fonts have loaded (the pixel fonts
 * change line boxes) and after every route change.
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);

    const apply = () => {
      if (mq.matches) {
        stopSmoothScroll();
        root.classList.remove("motion-on");
      } else {
        startSmoothScroll();
        root.classList.add("motion-on");
      }
    };
    apply();
    mq.addEventListener("change", apply);

    const onVisibility = () => {
      const lenis = getLenis();
      if (!lenis) return;
      if (document.hidden) lenis.stop();
      else lenis.start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#"]');
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href === "#" || !getLenis()) return;
      e.preventDefault();
      scrollToHash(href);
      history.replaceState(null, "", href);
    };
    document.addEventListener("click", onClick);

    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      mq.removeEventListener("change", apply);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onClick);
      root.classList.remove("motion-on");
      stopSmoothScroll();
    };
  }, []);

  // New route: Lenis re-measures the document and triggers re-read layout.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      getLenis()?.resize();
      ScrollTrigger.refresh();
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return <>{children}</>;
}
