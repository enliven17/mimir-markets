"use client";

import { useEffect } from "react";
import "./globals.css";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error("Global app error", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-pv-bg text-pv-text">
        <main className="min-h-screen flex items-center justify-center px-6">
          <section className="w-full max-w-2xl bp-paper border border-pv-border/25 bg-pv-surface p-8 sm:p-10 text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-pv-emerald font-bold">
              Safe fallback
            </p>
            <h1 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight">
              Something went wrong.
            </h1>
            <p className="mt-4 text-sm sm:text-base text-pv-muted">
              The app hit a fatal route error, but you can retry without reloading the whole session.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={reset}
                className="w-full sm:w-auto px-5 py-3 border border-pv-emerald bg-pv-emerald text-pv-bg font-bold hover:brightness-110 transition-all focus-ring"
              >
                Try again
              </button>
              <a
                href="/"
                className="w-full sm:w-auto px-5 py-3 border border-pv-border/25 hover:border-pv-border/40 hover:bg-pv-border/[0.04] transition-all focus-ring"
              >
                Reload home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
