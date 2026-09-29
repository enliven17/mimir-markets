"use client";

/** Small header chip with the connected wallet's token tier; hidden for "none". */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useHolderTier } from "./useHolderTier";

export default function TierChip() {
  const t = useTranslations("token");
  const { state } = useHolderTier();
  if (!state || state.tier === "none") return null;
  return (
    <Link
      href="/token"
      title={t("chipTitle")}
      className="hidden whitespace-nowrap border border-pv-emerald/40 bg-pv-emerald/[0.08] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-emerald focus-ring sm:inline-block"
    >
      {t(`tier.${state.tier}`)}
    </Link>
  );
}
