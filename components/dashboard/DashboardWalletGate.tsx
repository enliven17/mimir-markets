"use client";

/**
 * Portfolio without a connected wallet: a centred line and the connect button
 * straight on the page background, no card, so it reads as the page's state
 * rather than a box floating in the middle of it.
 */
import { useTranslations } from "next-intl";

import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { Link } from "@/i18n/navigation";

export default function DashboardWalletGate() {
  const t = useTranslations("dashboard");
  return (
    <section
      aria-labelledby="dashboard-connect-heading"
      className="mx-auto grid max-w-[480px] justify-items-center gap-3 py-16 text-center sm:py-24"
    >
      <h2 id="dashboard-connect-heading" className="m-0 font-display text-[1.6rem] leading-none text-cream">
        {t("connectTitle")}
      </h2>
      <p className="m-0 max-w-[34ch] text-[14px] leading-relaxed text-muted">{t("connectDesc")}</p>
      <div className="mt-3">
        <ConnectWalletButton />
      </div>
      <Link href="/arena" className="mt-1 text-[14px] text-coral underline-offset-4 hover:underline">
        {t("connectExploreLink")}
      </Link>
    </section>
  );
}
