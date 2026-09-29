"use client";

/** /token: the connected wallet's tier, its mainnet balances and the holder-proof button. */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import { useHolderTier } from "./useHolderTier";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function TokenYourTier() {
  const t = useTranslations("token");
  const { connected } = useWallet();
  const { wallet, state, loaded, proven, canSign, prove } = useHolderTier();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!connected || !wallet) return <p className="text-sm text-pv-muted">{t("connect")}</p>;

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
    <div className="space-y-3 text-sm">
      {state ? (
        <>
          <p className="font-display text-2xl font-bold uppercase tracking-tight text-pv-emerald">{t(`tier.${state.tier}`)}</p>
          <p className="font-mono text-xs text-pv-muted">
            {t("held", { symbol: state.symbol, mimir: state.launched ? fmt(state.balances.mimir) : "—", ansem: fmt(state.balances.ansem) })}
          </p>
        </>
      ) : (
        <p className="text-pv-muted">{loaded ? t("readFailed") : t("loading")}</p>
      )}
      {proven ? (
        <p className="text-xs text-pv-text/85">{t("proven")}</p>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onProve}
            disabled={busy || !canSign}
            className="border border-pv-emerald bg-pv-emerald px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-pv-bg transition-[filter] hover:brightness-110 disabled:opacity-50 focus-ring"
          >
            {busy ? t("proving") : t("prove")}
          </button>
          <p className="text-xs text-pv-muted">{canSign ? t("proofHelp") : t("noSign")}</p>
        </div>
      )}
      {error ? <p className="text-xs text-pv-danger">{error}</p> : null}
    </div>
  );
}
