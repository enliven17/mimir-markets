"use client";

/**
 * Shown only on claims where the price cross-check runs: the asset price is
 * read at the deadline from independent feeds, and sources that disagree
 * refund instead of settling. It is a check on the resolution source, not the
 * resolution source itself, so it says so. It also carries the CoinMarketCap
 * attribution where that data is actually used.
 */
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { priceCheckTarget } from "@/lib/price-consensus";
import { resolverFromUrl } from "@/lib/resolver-spec";
import CoinMarketCapMark from "@/components/brand/CoinMarketCapMark";

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
    <p className={`m-0 flex items-start gap-2 text-[12px] leading-relaxed text-muted ${className}`}>
      <ShieldCheck size={14} className="mt-0.5 shrink-0 text-coral" aria-hidden />
      <span>
        {t("crossCheck", { symbol: target.symbol, threshold: target.threshold.toLocaleString("en-US") })}{" "}
        {/* Inline, so the sentence wraps as text and the mark stays on the line after "and". */}
        {t("crossCheckData")}{" "}
        <CoinMarketCapMark height={11} className="align-baseline" />
      </span>
    </p>
  );
}
