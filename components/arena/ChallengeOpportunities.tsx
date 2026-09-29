"use client";

/**
 * "Where signals become claims": source-backed claim drafts under the arena
 * feed (GET /api/challenge-opportunities, rebuilt by the market-creator
 * worker). A draft that repeats a live claim links to it; the rest open the
 * create page. Renders nothing when the feature is off, the fetch fails or
 * there is nothing to show — it is a suggestion strip, not part of the feed.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { BlueprintHeading } from "@/components/BlueprintGrid";
import ChallengeOpportunityCard from "@/components/explorer/ChallengeOpportunityCard";
import type { ChallengeOpportunitiesResponse, ChallengeOpportunity } from "@/lib/claimDrafts";

const ENABLED = process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS === "1";
const LIMIT = 6;

export default function ChallengeOpportunities() {
  const t = useTranslations("explore");
  const [items, setItems] = useState<ChallengeOpportunity[]>([]);

  useEffect(() => {
    if (!ENABLED) return;
    const ctrl = new AbortController();
    fetch(`/api/challenge-opportunities?limit=${LIMIT}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ChallengeOpportunitiesResponse>) : null))
      .then((body) => setItems(body?.items ?? []))
      .catch(() => setItems([]));
    return () => ctrl.abort();
  }, []);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="arena-opportunities-heading">
      <BlueprintHeading id="arena-opportunities-heading" eyebrow={t("aiOpportunitiesTab")} subtitle={t("aiOpportunitiesBandHint")}>
        {t("aiOpportunitiesBandTitle")}
      </BlueprintHeading>
      <div className="grid grid-cols-1 gap-3 border-x border-b border-pv-border/25 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
        {items.map((o) => (
          <ChallengeOpportunityCard key={o.id} opportunity={o} />
        ))}
      </div>
    </section>
  );
}
