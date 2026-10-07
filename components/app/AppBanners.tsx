"use client";

/**
 * The installable app's glue, mounted once in the locale layout:
 *   - registers the service worker (public/sw.js: the offline page);
 *   - remembers the APK build that opened the site (?app=<versionCode>, lib/app-release.ts);
 *   - desktop: a thin "get the app" strip above the nav, until dismissed (phones never see it);
 *   - inside an older APK: a strip offering the new build.
 * The strip's height is published as --top-banner, which the nav and the page frame add to their top offset.
 */
import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";
import { APP_RELEASE, APP_VERSION_PARAM, appReleased } from "@/lib/app-release";

const DISMISS_KEY = "mimir-app-banner-dismissed";
const BUILD_KEY = "mimir-app-build";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Private mode or blocked storage: the strip just shows again next time.
  }
};

const readSession = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};

type Strip = "desktop" | "update" | null;

export default function AppBanners() {
  const [strip, setStrip] = useState<Strip>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    // The head script (app/layout.tsx) already read ?app=<build> into sessionStorage and marked html[data-app].
    const param = new URLSearchParams(location.search).get(APP_VERSION_PARAM);
    const build = Number((param && /^\d+$/.test(param) ? param : readSession(BUILD_KEY)) ?? 0);
    const inApp = document.documentElement.hasAttribute("data-app");
    // In the app the page is a screen, not a document: no accidental pinch zoom (the website keeps it).
    if (inApp) document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover");

    if (inApp) setStrip(build > 0 && build < APP_RELEASE.versionCode ? "update" : null);
    else if (appReleased() && read(DISMISS_KEY) !== "1" && window.matchMedia("(min-width: 1024px)").matches) setStrip("desktop");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (strip) root.dataset.topBanner = "";
    else delete root.dataset.topBanner;
    return () => void delete root.dataset.topBanner;
  }, [strip]);

  if (!strip) return null;
  const close = () => {
    if (strip === "desktop") write(DISMISS_KEY, "1");
    setStrip(null);
  };

  return (
    <div
      role="region"
      aria-label={strip === "update" ? "App update" : "Mobile app"}
      className="fixed inset-x-0 top-0 z-[60] flex h-[var(--top-banner)] items-center justify-center gap-3 bg-maroon px-10 pt-[env(safe-area-inset-top)] text-[13px] text-cream"
    >
      {strip === "update" ? (
        <span>
          A new version of the app is ready ({APP_RELEASE.versionName}).{" "}
          <a href={APP_RELEASE.apkPath} className="font-medium text-coral underline-offset-2 hover:underline">
            Update
          </a>
        </span>
      ) : (
        <span>
          Mimir is on Android.{" "}
          <Link href="/app" className="font-medium text-coral underline-offset-2 hover:underline">
            Get the mobile app →
          </Link>
        </span>
      )}
      <button type="button" onClick={close} aria-label="Dismiss" className="absolute right-3 rounded px-2 py-1 text-muted hover:text-cream">
        ✕
      </button>
    </div>
  );
}
