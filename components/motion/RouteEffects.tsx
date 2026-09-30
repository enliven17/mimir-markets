"use client";

import { useLayoutEffect } from "react";
import { requestRefresh, scrollToTop } from "@/lib/motion";

/**
 * Rendered by app/[locale]/template.tsx, so it mounts on every navigation
 * (templates remount, layouts do not). Lands each route at the top through
 * Lenis (replaces the old ScrollToTopOnLoad), then re-measures ScrollTrigger
 * once fonts are ready (one coalesced refresh, skipped without triggers).
 * Old triggers die with their useGSAP scopes. A URL with a hash keeps the
 * browser's jump to the anchor.
 */
export default function RouteEffects() {
  useLayoutEffect(() => {
    if (!window.location.hash) scrollToTop();
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) requestRefresh();
    };
    if (!document.fonts || document.fonts.status === "loaded") refresh();
    else document.fonts.ready.then(refresh);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
