"use client";

/**
 * Last-resort boundary: replaces the root layout, so no i18n, fonts or
 * providers are available. The route error layout on the plain tokens.
 */
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
    <html lang="en">
      <body>
        <div className="wall" aria-hidden />
        <main className="grid min-h-screen place-items-center px-[var(--gut)] py-10 text-center">
          <section className="glass-deep w-full max-w-[560px] rounded-4xl px-6 py-10 shadow-sheet sm:px-11">
            <p className="inline-flex items-center gap-2 text-status uppercase text-muted">
              <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-coral" />
              Safe fallback
            </p>
            <h1 className="mt-4 text-app-hero text-cream">Something went wrong.</h1>
            <p className="mx-auto mt-4 max-w-[36ch] text-copy text-muted">
              Mimir hit an error it could not recover from. Try again, or reload the home page.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button type="button" onClick={reset} className="btn-primary !min-h-[46px] !w-auto !px-5 !py-2.5 !text-[15px]">
                Try again
              </button>
              <a href="/" className="btn-ghost !min-h-[46px] !w-auto !px-5 !py-2.5 !text-[15px]">
                Reload home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
