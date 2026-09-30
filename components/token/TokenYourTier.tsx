"use client";

/** /token: the connected wallet's tier, its mainnet balances and the holder-proof button. */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";

import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { useHolderTier } from "./useHolderTier";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function TokenYourTier() {
  const t = useTranslations("token");
  const { connected } = useWallet();
  const { wallet, state, loaded, proven, canSign, prove } = useHolderTier();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!connected || !wallet) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[44ch] text-[14px] text-muted">{t("connect")}</p>
        <ConnectWalletButton />
      </div>
    );
  }

  async function onProve() {
    setBusy(true);
    setError(null);
    try {
      await prove();
    } catch {
      setError(t("noSign"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 sm:flex sm:items-end sm:justify-between">
      <div className="min-w-0">
        {state ? (
          <>
            <p className={`m-0 font-display text-[2rem] leading-none ${state.tier === "none" ? "text-muted" : "text-cream"}`}>
              {t(`tier.${state.tier}`)}
            </p>
            <p className="m-0 mt-2 font-mono text-[13px] text-muted">
              {t("held", { symbol: state.symbol, mimir: state.launched ? fmt(state.balances.mimir) : "-", ansem: fmt(state.balances.ansem) })}
            </p>
          </>
        ) : loaded ? (
          <p className="m-0 text-[14px] text-muted">{t("readFailed")}</p>
        ) : (
          <div role="status" aria-label={t("loading")} className="grid gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        )}
      </div>
      <div className="grid gap-1.5 sm:max-w-[300px] sm:justify-items-end sm:text-right">
        {proven ? (
          <p className="m-0 text-[13px] text-muted">{t("proven")}</p>
        ) : (
          <>
            <Button size="sm" variant="ghost" fullWidth={false} loading={busy} disabled={busy || !canSign} onClick={() => void onProve()}>
              {busy ? t("proving") : t("prove")}
            </Button>
            <p className="m-0 text-[12px] text-muted">{canSign ? t("proofHelp") : t("noSign")}</p>
          </>
        )}
        {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
