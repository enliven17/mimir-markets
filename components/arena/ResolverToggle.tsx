"use client";

import { useTranslations } from "next-intl";
import type { ResolverSpec } from "@/lib/resolver-spec";

/**
 * Offered on the create form when the claim is a single-asset price threshold
 * with Yes/No sides: settle it from price feeds at the deadline, no model.
 * The spec is appended to the resolution URL, which is stored on chain, so
 * every challenger can read it and nobody can change it after they stake.
 */
export default function ResolverToggle({
  spec,
  resolutionUrl,
  enabled,
  onChange,
}: {
  spec: Extract<ResolverSpec, { kind: "price" }>;
  resolutionUrl: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations("resolverToggle");
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl bg-cream/[0.04] p-4 text-[14px]">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--coral)]"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="grid min-w-0 gap-1">
        <span className="text-cream">{t("title")}</span>
        <span className="text-[13px] leading-relaxed text-muted">
          {t("body", { symbol: spec.symbol, op: spec.op, threshold: spec.threshold.toLocaleString("en-US") })}
        </span>
        {enabled ? <span className="break-all font-mono text-[11px] text-dim">{resolutionUrl}</span> : null}
      </span>
    </label>
  );
}
