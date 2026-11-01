import { setRequestLocale } from "next-intl/server";

import ArcWalletClient from "@/components/arc/ArcWalletClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/wallet",
  title: "Wallet · Mimir Markets",
  description: "Your EVM wallet is your Mimir account: connect it on Arc or Base and see your USDC on Arc.",
  index: false,
});

/** /wallet: the connected EVM wallet (the Mimir account) and its USDC on Arc. */
export default async function WalletPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <ArcWalletClient />;
}
