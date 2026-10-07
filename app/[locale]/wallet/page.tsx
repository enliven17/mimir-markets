import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import ArcWalletClient from "@/components/arc/ArcWalletClient";

export const metadata: Metadata = {
  title: "Arc wallet · Mimir",
  description: "Your passkey wallet on Arc: link it to your Solana wallet and move USDC between Solana and Arc through Circle's CCTP.",
};

/** /wallet: the passkey Arc account, its link to the Solana wallet, deposits and withdrawals. */
export default async function WalletPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <ArcWalletClient />;
}
