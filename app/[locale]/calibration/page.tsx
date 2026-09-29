import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { COUNCIL_PERSONAS } from "@/agents/council/personas";
import { calibrate, COIN_FLIP_BRIER, type CalibrationRow } from "@/lib/calibration";
import { scoredForecasts } from "@/lib/server/forecasts";
import { cachedFor } from "@/lib/server/ttl-cache";

export const dynamic = "force-dynamic";

const loadRows = cachedFor(async (): Promise<CalibrationRow[]> => calibrate(await scoredForecasts()), 60_000);

function nameOf(slug: string): string {
  if (slug === "oracle") return "Mimir oracle";
  const p = COUNCIL_PERSONAS.find((x) => x.slug === slug);
  return p ? `${p.emoji} ${p.displayName}` : slug;
}

function verdictOn(brier: number): { key: "sharp" | "better" | "coin"; className: string } {
  if (brier < 0.18) return { key: "sharp", className: "text-pv-emerald" };
  if (brier < COIN_FLIP_BRIER) return { key: "better", className: "text-pv-text" };
  return { key: "coin", className: "text-pv-danger" };
}

export default async function CalibrationPage() {
  const t = await getTranslations("calibration");
  const rows = await loadRows().catch(() => [] as CalibrationRow[]);

  return (
    <div className="pb-12">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("subtitle", { coin: COIN_FLIP_BRIER })}>
        {t("title")}
      </BlueprintHeading>
      <div className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
        {rows.length === 0 ? (
          <p className="border border-pv-border/25 bg-pv-surface p-8 text-center text-sm text-pv-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto border border-pv-border/25">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-pv-surface font-mono text-[11px] uppercase tracking-[0.14em] text-pv-muted">
                <tr>
                  <th className="px-4 py-3">{t("forecaster")}</th>
                  <th className="px-4 py-3 text-right">{t("settled")}</th>
                  <th className="px-4 py-3 text-right">{t("brier")}</th>
                  <th className="px-4 py-3 text-right">{t("rightSide")}</th>
                  <th className="px-4 py-3">{t("verdict")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pv-border/25">
                {rows.map((r) => {
                  const v = verdictOn(r.brier);
                  return (
                    <tr key={r.forecaster}>
                      <td className="px-4 py-3 text-pv-text">{nameOf(r.forecaster)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-pv-text/85">{r.forecasts}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-pv-text">{r.brier.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-pv-text/85">{Math.round(r.hitRate * 100)}%</td>
                      <td className={`px-4 py-3 text-xs ${v.className}`}>{t(`band.${v.key}`)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-6 text-center text-sm">
          <Link href="/agents" className="text-pv-muted hover:text-pv-text">{t("backToAgents")}</Link>
        </p>
      </div>
    </div>
  );
}
