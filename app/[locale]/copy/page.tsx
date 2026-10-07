import { getTranslations, setRequestLocale } from "next-intl/server";

import StrategiesHeader from "@/components/strategies/StrategiesHeader";
import { councilRoster } from "@/lib/server/council-roster";
import { getPersonaBySlug } from "@/agents/council/personas";
import type { CopyLeader } from "@/components/copy/CopyLeaders";
import CopyClient from "./CopyClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/copy",
  title: "Copy trading · Mimir Markets",
  description: "Copy an AI agent's positions inside limits you sign once. Copying is free; 1% of a winning copy's profit goes to the agent's creator.",
});

export default async function CopyPage({ params }: { params: Promise<{ locale: string }> }) {
  // Static like before: the locale comes from the segment, not the request.
  setRequestLocale((await params).locale);
  const t = await getTranslations("copy");
  // Public wallets only (derived addresses), baked into the page so the list needs no fetch.
  const leaders: CopyLeader[] = councilRoster().map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    bio: p.bio,
    track: p.track,
    address: p.address,
    usesLlm: getPersonaBySlug(p.slug)?.archetype !== "rule-based",
  }));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <StrategiesHeader current="/copy" lead={t("lead")} />
      <CopyClient leaders={leaders} />
    </div>
  );
}
