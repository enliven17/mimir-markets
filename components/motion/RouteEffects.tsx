"use client";

import { useLayoutEffect } from "react";
import { ScrollTrigger, getLenis, scrollToTop } from "@/lib/motion";

/**
 * Rendered by app/[locale]/template.tsx, so it mounts on every navigation
 * (templates remount, layouts do not). Lands each route at the top through
 * Lenis (replaces the old ScrollToTopOnLoad), then re-measures ScrollTrigger
 * once fonts are ready. Old triggers die with their useGSAP scopes. A URL
 * with a hash keeps the browser's jump to the anchor.
 */
export default function RouteEffects() {
  useLayoutEffect(() => {
    if (!window.location.hash) scrollToTop();
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      getLenis()?.resize();
      ScrollTrigger.refresh();
    };
    if (document.fonts?.status === "loaded") requestAnimationFrame(refresh);
    else document.fonts?.ready.then(refresh);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
