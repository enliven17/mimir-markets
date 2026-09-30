"use client";

/**
 * A ticking "2d 4h" / "3h 12m" countdown that never re-renders React: every
 * instance on the page shares one 1s interval that writes `textContent`
 * directly, and the interval stops when the last instance unmounts.
 */
import { useEffect, useRef } from "react";
import { formatCountdown } from "@/lib/claim-status";

type Tick = (now: number) => void;
const subscribers = new Set<Tick>();
let timer: number | undefined;

function subscribe(fn: Tick): () => void {
  subscribers.add(fn);
  if (timer === undefined) {
    timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      subscribers.forEach((s) => s(now));
    }, 1000);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export default function Countdown({
  until,
  format = (s) => s,
  className = "",
}: {
  /** Unix seconds. */
  until: number;
  /** Wraps the countdown text (e.g. "{time} left"); keep it stable. */
  format?: (countdown: string) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const write: Tick = (now) => {
      const el = ref.current;
      if (!el) return;
      const text = formatRef.current(formatCountdown(until, now));
      if (el.textContent !== text) el.textContent = text;
    };
    write(Math.floor(Date.now() / 1000));
    return subscribe(write);
  }, [until]);

  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      {format(formatCountdown(until, Math.floor(Date.now() / 1000)))}
    </span>
  );
}
