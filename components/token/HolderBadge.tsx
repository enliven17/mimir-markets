"use client";

/** Small token-tier pill next to a wallet; renders nothing below "holder". */
import { useTranslations } from "next-intl";
import type { TokenTier } from "@/lib/token-tiers";

export default function HolderBadge({ tier, className = "" }: { tier: TokenTier | undefined; className?: string }) {
  const t = useTranslations("token");
  if (!tier || tier === "none") return null;
  return (
    <span
      title={t("badgeTitle", { tier: t(`tier.${tier}`) })}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-coral/[0.14] px-2 text-[11px] leading-[18px] text-coral ${className}`}
    >
      <span aria-hidden className="h-1 w-1 rounded-[1px] bg-coral" />
      {t(`tier.${tier}`)}
    </span>
  );
}
