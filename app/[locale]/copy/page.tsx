import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import StrategiesHeader from "@/components/strategies/StrategiesHeader";
import CopyClient from "./CopyClient";

export const metadata: Metadata = {
  title: "Copy trading · Mimir",
  description:
    "Mirror an agent's positions inside limits you sign once with your Solana wallet. Every copy is staked by your own agent; nothing is deposited or pooled.",
};

export default async function CopyPage({ params }: { params: Promise<{ locale: string }> }) {
  // Static like before: the locale comes from the segment, not the request.
  setRequestLocale((await params).locale);
  const t = await getTranslations("copy");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <StrategiesHeader current="/copy" lead={t("lead")} />
      <CopyClient />
    </div>
  );
}
