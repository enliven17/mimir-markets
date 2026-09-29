"use client";

/** Dashboard without a connected wallet: one framed connect card. */
import { useTranslations } from "next-intl";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Wallet } from "lucide-react";

import { Link } from "@/i18n/navigation";

export default function DashboardWalletGate() {
  const t = useTranslations("dashboard");
  return (
    <div className="px-4 py-8 sm:px-6">
      <section aria-labelledby="dashboard-connect-heading" className="mx-auto max-w-md border border-pv-border/30 bg-pv-surface px-5 py-8 text-center">
        <Wallet className="mx-auto size-6 text-pv-muted" aria-hidden />
        <h2 id="dashboard-connect-heading" className="mt-4 text-sm font-semibold text-pv-text">
          {t("connectTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-pv-muted">{t("connectDesc")}</p>
        <div className="mt-6 flex justify-center">
          <WalletMultiButton />
        </div>
        <Link href="/arena" className="mt-6 inline-block text-xs text-pv-emerald underline-offset-4 hover:underline">
          {t("connectExploreLink")}
        </Link>
      </section>
    </div>
  );
}
