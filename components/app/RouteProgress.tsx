"use client";

/**
 * A thin coral bar at the top while a navigation is in flight, like an app's
 * loading line: it starts on a click on an internal link, creeps towards 85%,
 * and completes when the pathname changes. Never shown for a link to the page
 * you are on, a new tab, or a download.
 */
import { useEffect, useRef, useState } from "react";

import { usePathname } from "@/i18n/navigation";

export default function RouteProgress() {
  const pathname = usePathname();
  const [p, setP] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      setP(0.15);
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => setP((v) => (v === null ? v : Math.min(0.85, v + (0.85 - v) * 0.2))), 200);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setP((v) => (v === null ? null : 1));
    const done = window.setTimeout(() => setP(null), 320);
    return () => window.clearTimeout(done);
  }, [pathname]);

  if (p === null) return null;
  return <div aria-hidden className="route-progress" style={{ transform: `scaleX(${p})`, opacity: p >= 1 ? 0 : 1 }} />;
}
