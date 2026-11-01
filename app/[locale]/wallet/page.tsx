import { redirect } from "@/i18n/navigation";

/** Retired page: old bookmarks open the portfolio; wallet controls live in the header. */
export default async function WalletPage({ params }: { params: Promise<{ locale: string }> }) {
  redirect({ href: "/dashboard", locale: (await params).locale });
}
