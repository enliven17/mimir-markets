"use client";

/**
 * Copy trading body: your permissions (list and revoke), with the grant form
 * in a sheet opened from "New permission".
 *
 * The page first asks the API whether the feature is on (a bare GET, no
 * signature), so a deployment with the flag off shows one clear state instead
 * of a form that can only fail after a wallet prompt. The grant form's code
 * loads when the sheet first opens.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import { Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import Button, { buttonClass } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";
import CopyPermissionList from "@/components/copy/CopyPermissionList";
import { probeCopyTrading } from "@/lib/copy-client";

const CopyGrantForm = dynamic(() => import("@/components/copy/CopyGrantForm"), {
  ssr: false,
  loading: () => <Skeleton lines={4} />,
});

type Availability = "checking" | "enabled" | "disabled" | "unknown";

export default function CopyClient() {
  const t = useTranslations("copy");
  const { publicKey, connected } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [availability, setAvailability] = useState<Availability>("checking");
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void probeCopyTrading().then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markDisabled = useCallback(() => {
    setGranting(false);
    setAvailability("disabled");
  }, []);

  let body: ReactNode;
  if (availability === "checking") {
    body = (
      <div role="status" aria-label={t("checking")} className={`${SURFACE} grid gap-3 p-6`}>
        <Skeleton className="!h-6 w-1/3" />
        <Skeleton lines={2} />
      </div>
    );
  } else if (availability === "disabled") {
    body = (
      <EmptyState
        className="!max-w-[420px]"
        action={
          <Link href="/baskets" className={buttonClass("ghost", "sm")}>
            {t("disabledLink")}
          </Link>
        }
      >
        <span className="block font-display text-[1.35rem] leading-tight">{t("disabledTitle")}</span>
        <span className="mt-2 block text-[13px] text-muted">{t("disabledDesc")}</span>
      </EmptyState>
    );
  } else if (!connected || !address) {
    body = (
      <section
        aria-labelledby="copy-connect-heading"
        className={`${SURFACE} mx-auto grid w-full max-w-[520px] justify-items-center gap-3 px-6 py-10 text-center`}
      >
        <h2 id="copy-connect-heading" className="m-0 font-display text-[1.6rem] leading-none text-cream">
          {t("connectTitle")}
        </h2>
        <p className="m-0 max-w-[40ch] text-[14px] leading-relaxed text-muted">{t("connectDesc")}</p>
        <ConnectWalletButton className="mt-3" />
      </section>
    );
  } else {
    // Keyed by wallet so switching accounts never shows one wallet's list under another.
    body = (
      <section aria-labelledby="copy-list-heading" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="copy-list-heading" className="m-0 font-display text-[1.45rem] leading-none text-cream">
            {t("list.title")}
          </h2>
          <Button size="sm" fullWidth={false} onClick={() => setGranting(true)}>
            <Plus className="size-4" aria-hidden />
            {t("grant.open")}
          </Button>
        </div>
        <CopyPermissionList key={`list-${address}`} address={address} onDisabled={markDisabled} />
        <Modal
          open={granting}
          onClose={() => setGranting(false)}
          title={t("grant.title")}
          variant="sheet"
          closeLabel={t("grant.close")}
          className="sm:!max-w-[640px]"
        >
          <CopyGrantForm key={`grant-${address}`} address={address} onDisabled={markDisabled} />
        </Modal>
      </section>
    );
  }

  return (
    <>
      {body}
      <p className="m-0 text-center text-[13px] leading-relaxed text-muted">
        {t("agentsHint")}{" "}
        <Link href="/docs" className="text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral">
          docs/AGENTS.md
        </Link>
      </p>
    </>
  );
}
