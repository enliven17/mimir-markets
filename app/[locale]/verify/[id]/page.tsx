import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import { buttonClass } from "@/components/ui/Button";
import Disclosure from "@/components/ui/Disclosure";
import KeyValue from "@/components/ui/KeyValue";
import { Pending, StatusPill } from "@/components/ui/StatusPill";
import { verifyClaim, type VerificationReport } from "@/lib/server/verify";
import { SIDE_LABEL } from "@/lib/claim-status";
import { stripResolverFragment } from "@/lib/resolver-spec";

export const metadata = { robots: { index: false, follow: true } };

/**
 * /verify/[id]: one hero that says Verified or Mismatch (or why there is
 * nothing to check), then each part of the audit bundle behind a disclosure,
 * with the canonical JSON exactly as hashed in a mono well.
 */
export const dynamic = "force-dynamic";

type T = (key: string, values?: Record<string, string | number>) => string;
type Verdict = "verified" | "mismatch" | "noBundle" | "noHash" | "noVerdict" | "notFound";

const WELL =
  "m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink-deep p-4 font-mono text-[12px] leading-relaxed text-cream shadow-well";

function verdictOf(report: VerificationReport | null): Verdict {
  if (!report || !report.found) return "notFound";
  if (!report.hasVerdict) return "noVerdict";
  if (!report.onChain?.evidenceHash) return "noHash";
  if (!report.bundle) return "noBundle";
  return report.matches ? "verified" : "mismatch";
}

const TONE: Record<Verdict, { word: string; pill: "live" | "danger" | "neutral" }> = {
  verified: { word: "text-cream", pill: "live" },
  mismatch: { word: "text-danger", pill: "danger" },
  noBundle: { word: "text-cream", pill: "neutral" },
  noHash: { word: "text-cream", pill: "neutral" },
  noVerdict: { word: "text-cream", pill: "neutral" },
  notFound: { word: "text-cream", pill: "neutral" },
};

function Hero({ report, verdict, claimId, t }: { report: VerificationReport | null; verdict: Verdict; claimId: number; t: T }) {
  const c = report?.onChain;
  const side = c ? (report!.resolved ? c.winnerSide : c.proposedSide) : 0;
  const body: Record<Verdict, string> = {
    verified: t("verified"),
    mismatch: t("mismatch"),
    noBundle: t("noBundle"),
    noHash: t("noHash"),
    noVerdict: t("noVerdictYet"),
    notFound: t("notFound"),
  };
  return (
    <section aria-labelledby="verify-title" className={`${SURFACE} grid gap-5 p-6 sm:p-8`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={TONE[verdict].pill}>{t("claimLine", { id: claimId })}</StatusPill>
        {report?.hasVerdict && !report.resolved ? <Pending live={false}>{t("notFinal")}</Pending> : null}
      </div>
      <div className="grid gap-3">
        <h1 id="verify-title" className={`m-0 font-display text-app-hero ${TONE[verdict].word}`}>
          {t(`hero.${verdict}`)}
        </h1>
        <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-muted">{body[verdict]}</p>
      </div>
      {c && report?.hasVerdict ? (
        <div className="grid gap-1 border-t border-line pt-5">
          <p className="m-0 text-[15px] text-cream">
            {SIDE_LABEL[side] ?? "-"} <span className="text-muted">· {t("confidence", { n: c.confidence })}</span>
          </p>
          {c.summary ? <p className="m-0 line-clamp-3 text-[14px] leading-relaxed text-muted">{c.summary}</p> : null}
        </div>
      ) : null}
      {report?.found ? (
        <div className="flex flex-wrap items-center gap-3">
          {report.bundle ? (
            <a href={`/api/verify/${claimId}?raw=1`} className={buttonClass("primary", "sm")}>
              {t("download")}
            </a>
          ) : null}
          <Link href={`/arena/${claimId}`} className={buttonClass("ghost", "sm")}>
            {t("openMarket")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function Section({ summary, meta, open, children }: { summary: string; meta?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <Disclosure summary={summary} meta={meta} defaultOpen={open}>
      <div className="grid gap-3 text-[14px] leading-relaxed text-cream">{children}</div>
    </Disclosure>
  );
}

export default async function VerifyPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id } = await params;
  const t = await getTranslations("verify");
  const claimId = Number(id);
  const report = Number.isInteger(claimId) && claimId > 0 ? await verifyClaim(claimId).catch(() => null) : null;
  const verdict = verdictOf(report);
  const b = report?.bundle;
  const hash = report?.onChain?.evidenceHash;

  return (
    <div className="mx-auto grid w-full max-w-[var(--wrap-narrow)] grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <Hero report={report} verdict={verdict} claimId={claimId} t={t} />

      {report?.found && (hash || b) ? (
        <div className="grid gap-3">
          {hash ? (
            <Section summary={t("commitment")} open={verdict === "mismatch"}>
              <dl className="m-0 grid gap-3">
                <div>
                  <dt className="label">{t("onChainHash")}</dt>
                  <dd className="m-0 break-all font-mono text-[13px]">{hash}</dd>
                </div>
                {report.recomputedHash ? (
                  <div>
                    <dt className="label">{t("recomputedHash")}</dt>
                    <dd className={`m-0 break-all font-mono text-[13px] ${report.matches ? "" : "text-danger"}`}>
                      {report.recomputedHash}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {b ? (
                <p className="m-0 text-[13px] text-muted">
                  {t("checkYourself")} <code className="font-mono text-cream">sha256sum mimir-{claimId}-verdict.json</code>
                </p>
              ) : null}
            </Section>
          ) : null}

          {b ? (
            <>
              <Section summary={t("howDecided")}>
                <KeyValue
                  rows={[
                    { label: t("decidedBy"), value: b.model ?? (b.council ? t("councilTally") : "-") },
                    { label: t("decidedAt"), value: new Date(b.decidedAt).toISOString() },
                    ...(b.rawVerdict
                      ? [{ label: t("rawVerdict"), value: `${b.rawVerdict.verdict} (${b.rawVerdict.confidence}%)` }]
                      : []),
                    { label: t("finalVerdict"), value: `${b.finalVerdict.verdict} (${b.finalVerdict.confidence}%)` },
                  ]}
                />
                {b.adjustments.length > 0 ? (
                  <div>
                    <p className="label">{t("adjustments")}</p>
                    <ul className="m-0 grid list-disc gap-1 pl-5 text-muted">
                      {b.adjustments.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Section>

              {b.resolver ? (
                <Section summary={t("resolver")}>
                  <pre className={WELL} data-lenis-prevent>
                    {JSON.stringify(b.resolver.spec, null, 2)}
                  </pre>
                  <p className="m-0 text-muted">{b.resolver.detail}</p>
                </Section>
              ) : null}

              {b.prices ? (
                <Section
                  summary={t("prices", { symbol: b.prices.symbol, threshold: b.prices.threshold.toLocaleString("en-US") })}
                  meta={b.prices.readings.length}
                >
                  <KeyValue
                    rows={b.prices.readings.map((r) => ({
                      label: r.source,
                      value: `$${r.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })} · ${new Date(r.at).toISOString()}`,
                    }))}
                  />
                </Section>
              ) : null}

              {b.council ? (
                <Section summary={t("councilVotes")} meta={b.council.votes.length}>
                  <ul className="m-0 grid list-none gap-1 p-0 font-mono text-[13px] sm:grid-cols-2">
                    {b.council.votes.map((v) => (
                      <li key={v.slug}>
                        {v.slug}: {v.verdict} <span className="text-muted">({v.confidence}%)</span>
                      </li>
                    ))}
                  </ul>
                  {b.council.excluded?.length ? (
                    <p className="m-0 text-[13px] text-muted">{t("excluded", { list: b.council.excluded.join(", ") })}</p>
                  ) : null}
                </Section>
              ) : null}

              {b.evidence ? (
                <Section summary={t("evidence", { fetcher: b.evidence.fetcher })}>
                  <p className="m-0 break-all text-[13px] text-muted">{stripResolverFragment(b.claim.resolutionUrl)}</p>
                  <pre className={WELL} data-lenis-prevent>
                    {b.evidence.text}
                  </pre>
                </Section>
              ) : null}

              <Section summary={t("claimAsRead")}>
                <p className="m-0">{b.claim.question}</p>
                <p className="m-0 text-[13px] text-muted">
                  {t("positions", { creator: b.claim.creatorPosition, challengers: b.claim.counterPosition })}
                </p>
              </Section>

              {report.bundleText ? (
                <Section summary={t("raw")}>
                  <pre className={WELL} data-lenis-prevent>
                    {report.bundleText}
                  </pre>
                </Section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
