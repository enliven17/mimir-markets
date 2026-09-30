"use client";

/**
 * "Suggested claims": source-backed claim drafts under the arena feed
 * (GET /api/challenge-opportunities, rebuilt by the market-creator worker), as
 * a collapsed rail. Nothing is fetched until the rail scrolls into view.
 * Renders nothing when the feature is off, the fetch fails or there is
 * nothing to show: it is a suggestion strip, not part of the feed.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useInViewOnce } from "@/components/motion/hooks";
import { Disclosure, Rail } from "@/components/ui";
import ChallengeOpportunityCard from "@/components/explorer/ChallengeOpportunityCard";
import type { ChallengeOpportunitiesResponse, ChallengeOpportunity } from "@/lib/claimDrafts";

const ENABLED = process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS === "1";
const LIMIT = 6;

export default function ChallengeOpportunities() {
  const t = useTranslations("arena.feed");
  const sentinel = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(sentinel);
  const [items, setItems] = useState<ChallengeOpportunity[]>([]);

  useEffect(() => {
    if (!ENABLED || !seen) return;
    const ctrl = new AbortController();
    fetch(`/api/challenge-opportunities?limit=${LIMIT}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ChallengeOpportunitiesResponse>) : null))
      .then((body) => setItems(body?.items ?? []))
      .catch(() => setItems([]));
    return () => ctrl.abort();
  }, [seen]);

  if (!ENABLED) return null;
  if (items.length === 0) return <div ref={sentinel} aria-hidden className="h-px" />;

  return (
    <section aria-label={t("suggested")} className="fade-rise">
      <Disclosure summary={<span className="text-[15px] text-cream">{t("suggested")}</span>} meta={items.length}>
        <p className="m-0 mb-4 text-[13px] text-muted">{t("suggestedHint")}</p>
        <Rail label={t("suggested")} controls={items.length > 2}>
          {items.map((o) => (
            <ChallengeOpportunityCard key={o.id} opportunity={o} />
          ))}
        </Rail>
      </Disclosure>
    </section>
  );
}
