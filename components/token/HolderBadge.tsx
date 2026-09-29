"use client";

/** Tiny token-tier badge next to a wallet; renders nothing below "holder". */
import { useTranslations } from "next-intl";
import type { TokenTier } from "@/lib/token-tiers";

export default function HolderBadge({ tier, className = "" }: { tier: TokenTier | undefined; className?: string }) {
  const t = useTranslations("token");
  if (!tier || tier === "none") return null;
  return (
    <span
      title={t("badgeTitle", { tier: t(`tier.${tier}`) })}
      className={`inline-block whitespace-nowrap border border-pv-emerald/40 bg-pv-emerald/[0.08] px-1.5 py-px font-mono text-[9px] font-bold uppercase leading-4 tracking-[0.12em] text-pv-emerald ${className}`}
    >
      {t(`tier.${tier}`)}
    </span>
  );
}
