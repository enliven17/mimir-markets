"use client";

/** Loads the landing companion (./Companion.tsx) in its own chunk once the page is loaded and the browser is idle. */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const Companion = dynamic(() => import("./Companion"), { ssr: false });

export default function CompanionMount() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let idle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => setReady(true);
    const start = () => {
      if ("requestIdleCallback" in window) idle = requestIdleCallback(go, { timeout: 2500 });
      else timer = setTimeout(go, 1200);
    };
    if (document.readyState === "complete") start();
    else addEventListener("load", start, { once: true });
    return () => {
      removeEventListener("load", start);
      if (idle) cancelIdleCallback(idle);
      clearTimeout(timer);
    };
  }, []);
  return ready ? <Companion /> : null;
}
