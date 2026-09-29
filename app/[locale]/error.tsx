"use client";

/** Route error (radio `.error-page`): one centred sheet, one line, two actions. */
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Card";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function LocaleError({ error, reset }: Props) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error("Localized route error", error);
  }, [error]);

  return (
    <section className="grid min-h-[60vh] place-items-center py-10">
      <Sheet center className="max-w-[560px]">
        <p className="inline-flex items-center gap-2 text-status uppercase text-muted">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-coral shadow-[0_0_7px_rgb(255_81_72/.58)]" />
          {t("status")}
        </p>
        <h1 className="mt-4 font-display text-app-hero text-cream">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-[36ch] text-copy text-muted">{t("body")}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button type="button" onClick={reset} className={buttonClass("primary", "sm")}>
            {t("retry")}
          </button>
          <Link href="/arena" className={buttonClass("ghost", "sm")}>
            {t("home")}
          </Link>
        </div>
      </Sheet>
    </section>
  );
}
