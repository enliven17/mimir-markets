"use client";

/**
 * Pull down at the top of the page to refresh, in the installed app only
 * (html[data-app]; a browser has its own). Past PULL_PX it re-runs the
 * server components (router.refresh) and remounts its children, so their live
 * queries and balances load again; a spinner follows the finger meanwhile.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

import { useRouter } from "@/i18n/navigation";

const PULL_PX = 72;

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (!document.documentElement.hasAttribute("data-app")) return;
    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !document.querySelector('[aria-modal="true"]') ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      setPull(Math.max(0, Math.min(PULL_PX * 1.6, (e.touches[0].clientY - start.current) * 0.55)));
    };
    const onEnd = () => {
      if (start.current === null) return;
      start.current = null;
      setPull((p) => {
        if (p >= PULL_PX) {
          setBusy(true);
          router.refresh();
          setRound((r) => r + 1);
          window.setTimeout(() => setBusy(false), 700);
        }
        return 0;
      });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [router]);

  const shown = busy || pull > 8;
  return (
    <>
      {shown ? (
        <div
          role="status"
          aria-label={busy ? "Refreshing" : "Pull to refresh"}
          className="pointer-events-none fixed inset-x-0 z-[56] flex justify-center"
          style={{ top: `calc(84px + env(safe-area-inset-top) + ${busy ? 12 : pull * 0.5}px)` }}
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-panel-raised text-coral shadow-modal">
            <RotateCw size={16} aria-hidden className={busy ? "animate-spin" : ""} style={busy ? undefined : { transform: `rotate(${(pull / PULL_PX) * 300}deg)`, opacity: Math.min(1, pull / PULL_PX) }} />
          </span>
        </div>
      ) : null}
      <div key={round}>{children}</div>
    </>
  );
}
