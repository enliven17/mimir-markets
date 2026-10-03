import type { Metadata } from "next";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";

import TelegramLinkClient from "./TelegramLinkClient";

export const metadata: Metadata = {
  title: "Link Telegram · Mimir",
  description: "Link your Solana wallet to the Mimir Telegram bot for new-market and bet-result messages.",
  robots: { index: false },
};

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
