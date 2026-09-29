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
    <label className="flex cursor-pointer gap-3 border border-pv-border/25 bg-pv-surface p-4 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--pv-accent))]"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-semibold text-pv-text">{t("title")}</span>
        <span className="mt-1 block text-xs leading-relaxed text-pv-muted">
          {t("body", { symbol: spec.symbol, op: spec.op, threshold: spec.threshold.toLocaleString("en-US") })}
        </span>
        {enabled ? <span className="mt-2 block break-all font-mono text-[10px] text-pv-muted">{resolutionUrl}</span> : null}
      </span>
    </label>
  );
}
