"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

const COPY = {
  en: {
    eyebrow: "Recovered safely",
    title: "This page hit a snag.",
    body: "Mimir kept the rest of the app alive. Try the request again or head back to the arena.",
    retry: "Try again",
    home: "Back home",
  },
  es: {
    eyebrow: "Recuperado",
    title: "Esta pagina fallo.",
    body: "Mimir mantuvo viva el resto de la app. Intenta otra vez o vuelve a la arena.",
    retry: "Intentar de nuevo",
    home: "Volver al inicio",
  },
} as const;

export default function LocaleError({ error, reset }: Props) {
  const params = useParams<{ locale?: string }>();
  const locale = params?.locale === "en" ? "en" : "es";
  const copy = COPY[locale];

  useEffect(() => {
    console.error("Localized route error", error);
  }, [error]);

  return (
    <section className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-2xl bp-paper border border-pv-border/25 bg-pv-surface p-8 sm:p-10 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-pv-emerald font-bold">
          {copy.eyebrow}
        </p>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight text-pv-text">
          {copy.title}
        </h1>
        <p className="mt-4 text-sm sm:text-base text-pv-muted max-w-xl mx-auto">
          {copy.body}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={reset}
            className="w-full sm:w-auto px-5 py-3 border border-pv-emerald bg-pv-emerald text-pv-bg font-bold hover:brightness-110 transition-all focus-ring"
          >
            {copy.retry}
          </button>
          <a
            href={`/${locale}`}
            className="w-full sm:w-auto px-5 py-3 border border-pv-border/25 text-pv-text hover:border-pv-border/40 hover:bg-pv-border/[0.04] transition-all focus-ring"
          >
            {copy.home}
          </a>
        </div>
      </div>
    </section>
  );
}
