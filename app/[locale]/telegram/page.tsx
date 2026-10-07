import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";

import TelegramLinkClient from "./TelegramLinkClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/telegram",
  title: "Link Telegram · Mimir Markets",
  description: "Link your wallet to the Mimir Telegram bot for new-market and result messages.",
  index: false,
});

/** /telegram?code=…: the page the bot's "Link wallet" button opens. */
export default async function TelegramPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  // useSearchParams needs a boundary on a statically rendered page.
  return (
    <Suspense>
      <TelegramLinkClient />
    </Suspense>
  );
}
