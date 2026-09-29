"use client";

/**
 * Shown only on claims where the price cross-check runs: the asset price is
 * read at the deadline from independent feeds, and sources that disagree
 * refund instead of settling. It is a check on the resolution source, not the
 * resolution source itself, so it says so.
 */
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { priceCheckTarget } from "@/lib/price-consensus";
import { resolverFromUrl } from "@/lib/resolver-spec";

export default function PriceCrossCheckNote({
  question,
  resolutionUrl,
  className = "",
}: {
  question: string;
  resolutionUrl: string;
  className?: string;
}) {
  const t = useTranslations("settlementPreview");
  const spec = resolverFromUrl(resolutionUrl);
  const target = spec?.kind === "price" ? { symbol: spec.symbol, threshold: spec.threshold } : priceCheckTarget(question);
  if (!target) return null;
  return (
    <p className={`flex items-start gap-1.5 text-[11px] leading-relaxed text-pv-muted ${className}`}>
      <ShieldCheck size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span>{t("crossCheck", { symbol: target.symbol, threshold: target.threshold.toLocaleString("en-US") })}</span>
    </p>
  );
}
