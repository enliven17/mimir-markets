import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { verifyClaim, type VerificationReport } from "@/lib/server/verify";
import { SIDE_LABEL } from "@/lib/claim-status";
import { stripResolverFragment } from "@/lib/resolver-spec";

export const dynamic = "force-dynamic";

type T = (key: string, values?: Record<string, string | number>) => string;

const CARD = "border border-pv-border/25 bg-pv-surface p-4 sm:p-5";
const LABEL = "font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-pv-muted";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className={`${LABEL} mb-3`}>{title}</h2>
      {children}
    </section>
  );
}

function OnChainVerdict({ report, t }: { report: VerificationReport; t: T }) {
  const c = report.onChain!;
  if (!report.hasVerdict) return <p className="text-sm text-pv-muted">{t("noVerdictYet")}</p>;
  const side = report.resolved ? c.winnerSide : c.proposedSide;
  return (
    <div className="space-y-2">
      <p className="font-display text-xl font-bold text-pv-text">
        {SIDE_LABEL[side] ?? "—"}
        {!report.resolved ? <span className="ml-2 font-mono text-xs uppercase text-pv-gold">{t("notFinal")}</span> : null}
      </p>
      <p className="text-sm text-pv-muted">{t("confidence", { n: c.confidence })}</p>
      <p className="text-sm leading-relaxed text-pv-text/90">{c.summary}</p>
    </div>
  );
}

function MatchBadge({ report, t }: { report: VerificationReport; t: T }) {
  if (!report.hasVerdict) return null;
  if (!report.onChain?.evidenceHash) return <p className="text-sm text-pv-muted">{t("noHash")}</p>;
  if (!report.bundle) {
    return <p className="border border-pv-gold/40 bg-pv-gold/[0.06] px-3 py-2 text-sm text-pv-text">{t("noBundle")}</p>;
  }
  return report.matches ? (
    <p className="border border-pv-emerald/40 bg-pv-emerald/[0.07] px-3 py-2 text-sm text-pv-text">✓ {t("verified")}</p>
  ) : (
    <p className="border border-pv-danger/40 bg-pv-danger/[0.08] px-3 py-2 text-sm text-pv-danger">✗ {t("mismatch")}</p>
  );
}

export default async function VerifyPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id } = await params;
  const t = await getTranslations("verify");
  const claimId = Number(id);
  const report = Number.isInteger(claimId) && claimId > 0 ? await verifyClaim(claimId).catch(() => null) : null;
  const b = report?.bundle;
  const rawHref = `/api/verify/${claimId}?raw=1`;

  return (
    <div className="pb-12">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("subtitle")}>
        {t("title")}
      </BlueprintHeading>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-6 sm:px-6">
        {!report || !report.found ? (
          <p className="text-center text-sm text-pv-muted">{t("notFound")}</p>
        ) : (
          <>
            <p className="text-center text-sm text-pv-muted">
              {t("claimLine", { id: claimId })} ·{" "}
              <Link href={`/arena/${claimId}`} className="underline decoration-pv-emerald/60 underline-offset-2 hover:text-pv-text">
                {t("openMarket")}
              </Link>
            </p>

            <Section title={t("onChainVerdict")}>
              <OnChainVerdict report={report} t={t} />
            </Section>

            <MatchBadge report={report} t={t} />

            {report.onChain?.evidenceHash ? (
              <Section title={t("commitment")}>
                <dl className="space-y-2 break-all font-mono text-xs text-pv-text/85">
                  <div>
                    <dt className={LABEL}>{t("onChainHash")}</dt>
                    <dd>{report.onChain.evidenceHash}</dd>
                  </div>
                  {report.recomputedHash ? (
                    <div>
                      <dt className={LABEL}>{t("recomputedHash")}</dt>
                      <dd>{report.recomputedHash}</dd>
                    </div>
                  ) : null}
                </dl>
                {b ? (
                  <p className="mt-3 text-xs leading-relaxed text-pv-muted">
                    <a href={rawHref} className="underline decoration-pv-emerald/60 underline-offset-2 hover:text-pv-text">
                      {t("download")}
                    </a>{" "}
                    {t("checkYourself")} <code className="font-mono">sha256sum mimir-{claimId}-verdict.json</code>
                  </p>
                ) : null}
              </Section>
            ) : null}

            {b ? (
              <>
                <Section title={t("howDecided")}>
                  <ul className="space-y-1.5 text-sm text-pv-text/90">
                    <li><span className="text-pv-muted">{t("decidedBy")}</span> {b.model ?? (b.council ? t("councilTally") : "—")}</li>
                    <li><span className="text-pv-muted">{t("decidedAt")}</span> {new Date(b.decidedAt).toISOString()}</li>
                    {b.rawVerdict ? (
                      <li><span className="text-pv-muted">{t("rawVerdict")}</span> {b.rawVerdict.verdict} ({b.rawVerdict.confidence}%)</li>
                    ) : null}
                    <li><span className="text-pv-muted">{t("finalVerdict")}</span> {b.finalVerdict.verdict} ({b.finalVerdict.confidence}%)</li>
                  </ul>
                  {b.adjustments.length > 0 ? (
                    <div className="mt-3">
                      <p className={LABEL}>{t("adjustments")}</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-pv-text/85">
                        {b.adjustments.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </Section>

                {b.resolver ? (
                  <Section title={t("resolver")}>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-pv-surface2 p-3 font-mono text-xs text-pv-text/85">
                      {JSON.stringify(b.resolver.spec, null, 2)}
                    </pre>
                    <p className="mt-2 text-sm text-pv-text/90">{b.resolver.detail}</p>
                  </Section>
                ) : null}

                {b.prices ? (
                  <Section title={t("prices", { symbol: b.prices.symbol, threshold: b.prices.threshold.toLocaleString("en-US") })}>
                    <ul className="space-y-1 font-mono text-xs text-pv-text/85">
                      {b.prices.readings.map((r) => (
                        <li key={r.source}>
                          {r.source}: ${r.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })} · {new Date(r.at).toISOString()}
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}

                {b.council ? (
                  <Section title={t("councilVotes")}>
                    <ul className="grid gap-1 font-mono text-xs text-pv-text/85 sm:grid-cols-2">
                      {b.council.votes.map((v) => (
                        <li key={v.slug}>{v.slug}: {v.verdict} ({v.confidence}%)</li>
                      ))}
                    </ul>
                    {b.council.excluded?.length ? (
                      <p className="mt-2 text-xs text-pv-muted">{t("excluded", { list: b.council.excluded.join(", ") })}</p>
                    ) : null}
                  </Section>
                ) : null}

                {b.evidence ? (
                  <Section title={t("evidence", { fetcher: b.evidence.fetcher })}>
                    <p className="mb-2 break-all text-xs text-pv-muted">{stripResolverFragment(b.claim.resolutionUrl)}</p>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-pv-surface2 p-3 font-mono text-[11px] leading-relaxed text-pv-text/80">
                      {b.evidence.text}
                    </pre>
                  </Section>
                ) : null}

                <Section title={t("claimAsRead")}>
                  <p className="text-sm text-pv-text">{b.claim.question}</p>
                  <p className="mt-2 text-xs text-pv-muted">
                    {t("positions", { creator: b.claim.creatorPosition, challengers: b.claim.counterPosition })}
                  </p>
                </Section>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
