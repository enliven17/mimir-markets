import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import ErrorPanel from "@/components/ErrorPanel";
import { buttonClass } from "@/components/ui/Button";

export default function LocaleNotFound() {
  const t = useTranslations("notFound");
  return (
    <ErrorPanel
      status={t("status")}
      title={t("title")}
      body={t("body")}
      actions={
        <>
          <Link href="/arena" className={buttonClass("primary", "sm")}>
            {t("arena")}
          </Link>
          <Link href="/" className={buttonClass("ghost", "sm")}>
            {t("home")}
          </Link>
        </>
      }
    />
  );
}
