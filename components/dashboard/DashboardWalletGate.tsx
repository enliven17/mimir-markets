"use client";

/** Portfolio without a connected wallet: one centred connect sheet. */
import { useTranslations } from "next-intl";

import { SURFACE_DEEP } from "@/components/arena/surface";
import { Sheet } from "@/components/ui/Card";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { Link } from "@/i18n/navigation";

export default function DashboardWalletGate() {
  const t = useTranslations("dashboard");
  return (
    <Sheet center className={`mx-auto max-w-[480px] !px-6 !py-9 ${SURFACE_DEEP}`}>
      <section aria-labelledby="dashboard-connect-heading" className="grid justify-items-center gap-3">
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
    </Sheet>
  );
}
