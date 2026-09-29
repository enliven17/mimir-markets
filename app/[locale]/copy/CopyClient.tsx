"use client";

/**
 * Copy trading: list and revoke your permissions, or grant a new one.
 *
 * The page first asks the API whether the feature is on (a bare GET, no
 * signature), so a deployment with the flag off shows one clear state instead
 * of a form that can only fail after a wallet prompt.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { ArrowUpRight, PowerOff, Wallet } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading, BlueprintSection, BlueprintStat } from "@/components/BlueprintGrid";
import CopyPermissionList from "@/components/copy/CopyPermissionList";
import CopyGrantForm from "@/components/copy/CopyGrantForm";
import { probeCopyTrading } from "@/lib/copy-client";

type Availability = "checking" | "enabled" | "disabled" | "unknown";

export default function CopyClient() {
  const t = useTranslations("copy");
  const { publicKey, connected } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [availability, setAvailability] = useState<Availability>("checking");

  useEffect(() => {
    let cancelled = false;
    void probeCopyTrading().then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markDisabled = useCallback(() => setAvailability("disabled"), []);

  let body: ReactNode;
  if (availability === "checking") {
    body = (
      <p role="status" className="px-4 py-10 text-center font-mono text-xs text-pv-muted">
        {t("checking")}
      </p>
    );
  } else if (availability === "disabled") {
    body = (
      <div className="px-4 py-8 sm:px-6">
        <section
          aria-labelledby="copy-disabled-heading"
          className="bp-paper border border-dashed border-pv-border/40 px-5 py-10 text-center"
        >
          <PowerOff className="mx-auto size-5 text-pv-muted" aria-hidden />
          <h2 id="copy-disabled-heading" className="mt-3 text-sm font-semibold text-pv-text">
            {t("disabledTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-pv-muted">{t("disabledDesc")}</p>
          <Link
            href="/baskets"
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-text underline decoration-pv-emerald underline-offset-4"
          >
            {t("disabledLink")} <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </section>
      </div>
    );
  } else if (!connected || !address) {
    body = (
      <div className="px-4 py-8 sm:px-6">
        <section aria-labelledby="copy-connect-heading" className="mx-auto max-w-md border border-pv-border/30 bg-pv-surface px-5 py-8 text-center">
          <Wallet className="mx-auto size-6 text-pv-muted" aria-hidden />
          <h2 id="copy-connect-heading" className="mt-4 text-sm font-semibold text-pv-text">
            {t("connectTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-pv-muted">{t("connectDesc")}</p>
          <div className="mt-6 flex justify-center">
            <ConnectWalletButton />
          </div>
        </section>
      </div>
    );
  } else {
    // Keyed by wallet so switching accounts never shows one wallet's list under another.
    body = (
      <>
        <BlueprintSection title={t("list.title")}>
          <CopyPermissionList key={`list-${address}`} address={address} onDisabled={markDisabled} />
        </BlueprintSection>
        <BlueprintSection title={t("grant.title")}>
          <CopyGrantForm key={`grant-${address}`} address={address} onDisabled={markDisabled} />
        </BlueprintSection>
      </>
    );
  }

  return (
    <div className="pb-16">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("intro")}>
        {t("title")}
      </BlueprintHeading>
      <div className="bp-cells grid-cols-3 border-b border-pv-border/25">
        <BlueprintStat value={t("statCustodyValue")} label={t("statCustody")} tone="gold" />
        <BlueprintStat value={t("statDepthValue")} label={t("statDepth")} tone="text" />
        <BlueprintStat value={t("statSignerValue")} label={t("statSigner")} />
      </div>
      {body}
      <p className="mx-auto mt-8 max-w-2xl px-4 text-center text-[11px] leading-relaxed text-pv-muted">
        {t("agentsHint")}{" "}
        <Link href="/docs" className="text-pv-emerald hover:underline">
          docs/AGENTS.md
        </Link>
      </p>
    </div>
  );
}
