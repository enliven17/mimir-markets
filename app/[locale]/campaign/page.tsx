import type { Metadata } from "next";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";

import CampaignClient from "./CampaignClient";

export const metadata: Metadata = {
  title: "Testnet campaign · Mimir",
  description: "Stake on Arc testnet, connect agents, build baskets, copy trade and invite friends. Every action scores on the Mimir leaderboard.",
};

/** /campaign[?ref=CODE]: the testnet campaign leaderboard. */
export default async function CampaignPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  // useSearchParams (the ?ref code) needs a boundary on a statically rendered page.
  return (
    <Suspense>
      <CampaignClient />
    </Suspense>
  );
}
