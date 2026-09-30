"use client";

import { useEffect, useState } from "react";
import { cachedBody, fetchBody } from "@/lib/json-cache";

/**
 * Poll a JSON endpoint every `ms` while the tab is visible (and once more when
 * it comes back). The body is compared as text, so an unchanged response
 * never sets state and never re-renders the page. `pick` maps the parsed body
 * to the value kept (return undefined to keep the last good value).
 * The first render uses the tab's last answer for `url` (lib/json-cache), so a
 * revisited page shows data at once and refreshes it in the background.
 */
export function usePolledJson<T>(url: string, ms: number, pick: (json: unknown) => T | undefined): T | null {
  const [value, setValue] = useState<T | null>(() => {
    const body = cachedBody(url);
    if (body === null) return null;
    try {
      return pick(JSON.parse(body)) ?? null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let alive = true;
    let lastBody = cachedBody(url) ?? "";
    const load = async () => {
      if (document.hidden) return;
      try {
        const { body } = await fetchBody(url);
        if (!alive || body === lastBody) return;
        lastBody = body;
        const next = pick(JSON.parse(body));
        if (next !== undefined) setValue(next);
      } catch {
        // keep last good state
      }
    };
    void load();
    const timer = setInterval(load, ms);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `pick` is a mapping, not a dependency: callers pass an inline function.
  }, [url, ms]);

  return value;
}
