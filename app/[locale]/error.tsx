"use client";

/** Route error page: one centred sheet, one line, two actions. */
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import ErrorPanel from "@/components/ErrorPanel";
import { buttonClass } from "@/components/ui/Button";

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
    <ErrorPanel
      status={t("status")}
      title={t("title")}
      body={t("body")}
      actions={
        <>
          <button type="button" onClick={reset} className={buttonClass("primary", "sm")}>
            {t("retry")}
          </button>
          <Link href="/arena" className={buttonClass("ghost", "sm")}>
            {t("home")}
          </Link>
        </>
      }
    />
  );
}
