import { getTranslations } from "next-intl/server";
import { SURFACE } from "@/components/arena/surface";
import StatsHeader from "@/components/stats/StatsHeader";
import EmptyState from "@/components/ui/EmptyState";
import { COUNCIL_PERSONAS } from "@/agents/council/personas";
import { calibrate, COIN_FLIP_BRIER, type CalibrationRow } from "@/lib/calibration";
import { scoredForecasts } from "@/lib/server/forecasts";
import { cachedFor } from "@/lib/server/ttl-cache";

/** /calibration: the stats header with the Calibration tab selected, then one Brier table. */
export const dynamic = "force-dynamic";

const loadRows = cachedFor(async (): Promise<CalibrationRow[]> => calibrate(await scoredForecasts()), 60_000);

function nameOf(slug: string): string {
  if (slug === "oracle") return "Mimir oracle";
  const p = COUNCIL_PERSONAS.find((x) => x.slug === slug);
  return p ? `${p.emoji} ${p.displayName}` : slug;
}

function verdictOn(brier: number): { key: "sharp" | "better" | "coin"; className: string } {
  if (brier < 0.18) return { key: "sharp", className: "bg-coral/[0.16] text-pending" };
  if (brier < COIN_FLIP_BRIER) return { key: "better", className: "bg-cream/[0.08] text-cream" };
  return { key: "coin", className: "bg-danger/[0.12] text-danger" };
}

export default async function CalibrationPage() {
  const t = await getTranslations("calibration");
  const rows = await loadRows().catch(() => [] as CalibrationRow[]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <StatsHeader current="/calibration" lead={t("lead", { coin: COIN_FLIP_BRIER })} />
      {rows.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <div className={`${SURFACE} overflow-x-auto`} data-lenis-prevent>
          <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
            <thead className="text-[11px] uppercase tracking-[0.06em] text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-3.5 font-normal">{t("forecaster")}</th>
                <th className="px-4 py-3.5 text-right font-normal">{t("settled")}</th>
                <th className="px-4 py-3.5 text-right font-normal">{t("brier")}</th>
                <th className="px-4 py-3.5 text-right font-normal">{t("rightSide")}</th>
                <th className="px-5 py-3.5 font-normal">{t("verdict")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const v = verdictOn(r.brier);
                return (
                  <tr key={r.forecaster}>
                    <td className="px-5 py-3.5 text-cream">{nameOf(r.forecaster)}</td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums text-muted">{r.forecasts}</td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums text-cream">{r.brier.toFixed(3)}</td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums text-muted">{Math.round(r.hitRate * 100)}%</td>
                    <td className="px-5 py-3.5">
                      <span className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] ${v.className}`}>{t(`band.${v.key}`)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
