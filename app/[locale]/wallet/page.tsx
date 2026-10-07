import { setRequestLocale } from "next-intl/server";

import ArcWalletClient from "@/components/arc/ArcWalletClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/wallet",
  title: "Arc wallet · Mimir Markets",
  description: "Your passkey account on Arc: link it to your Solana wallet and move USDC between Solana and Arc over Circle CCTP.",
  index: false,
});

/** /wallet: the passkey Arc account, its link to the Solana wallet, deposits and withdrawals. */
export default async function WalletPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <ArcWalletClient />;
}
