"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SplitReveal, useRiseBatch } from "@/components/motion";
import { Rail, Skeleton, SlotPlaceholder } from "@/components/ui";
import { ledgerEntries, type LedgerEntry } from "@/lib/landing";
import { formatUsdcBare } from "@/lib/money";
import { useLandingFeed } from "./LandingFeed";
import { PixelArrow } from "./icons";

function LedgerCard({ entry }: { entry: LedgerEntry }) {
  const t = useTranslations("home.ledger");
  const { claim, tag, side, pool } = entry;
  const summary = claim.resolutionSummary?.trim();
  return (
    <Link href={`/arena/${claim.id}`} className="l-card">
      <div className="l-card-top">
        <span className="l-tag" data-tag={tag}>
          {t(`tags.${tag}`)}
        </span>
        <span className="font-mono text-dim">#{claim.id}</span>
      </div>
      <h3>{claim.question}</h3>
      <div className="l-card-verdict">
        <div>
          <p>
            {tag !== "refund" && claim.confidence > 0 ? `${t("confidence", { value: claim.confidence })} · ` : ""}
            {summary || t(`side.${side}` as "side.1")}
          </p>
        </div>
      </div>
      <div className="l-card-foot">
        <span>{t(`side.${side}` as "side.1")}</span>
        <span className="font-mono text-cream">
          {formatUsdcBare(pool)} <small className="text-[11px] text-muted">USDC</small>
        </span>
      </div>
    </Link>
  );
}

/**
 * 6. The ledger: the last settled claims as a snap rail, each tagged by how
 * firm its verdict was; hovering (or focusing) a card shows the verdict line.
 */
export default function LedgerRail() {
  const t = useTranslations("home.ledger");
  const tc = useTranslations("home.claim");
  const { feed, status } = useLandingFeed();
  const root = useRef<HTMLElement>(null);
  const entries = ledgerEntries(feed);

  useRiseBatch(root);

  return (
    <section ref={root} className="l-section !pb-[clamp(40px,6vw,80px)]" aria-labelledby="ledger-title">
      <div className="l-wrap l-ledger-head">
        <div>
          <p className="eyebrow l-eyebrow" data-rise>
            {t("eyebrow")}
          </p>
          <SplitReveal>
            <h2 id="ledger-title" className="l-h2">
              {t("title")} <span className="l-accent">{t("titleAccent")}</span>
            </h2>
          </SplitReveal>
        </div>
        <Link href="/stats" className="l-link" data-rise>
          {t("all")}
          <PixelArrow size={14} />
        </Link>
      </div>
      <div className="l-rail-wrap" data-rise>
        {entries.length > 0 ? (
          <Rail className="l-rail" label={t("railLabel")} prevLabel={t("prev")} nextLabel={t("next")} controls={entries.length > 1}>
            {entries.map((e) => (
              <LedgerCard key={e.claim.id} entry={e} />
            ))}
          </Rail>
        ) : (
          <div className="l-wrap">
            {status === "loading" ? (
              <div className="grid gap-4 sm:grid-cols-3" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="l-card">
                    <Skeleton className="w-1/3" />
                    <Skeleton lines={3} />
                  </div>
                ))}
              </div>
            ) : (
              <SlotPlaceholder label={status === "error" ? tc("offline") : t("empty")} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
