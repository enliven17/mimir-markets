"use client";

/**
 * Stands in for a stake or create form until the viewer can use it: Arc not
 * configured, the passkey session still restoring, or no Arc account yet. The
 * account is set up right here (connect, passkey, link in one go), so nobody
 * has to leave the market to find the wallet page.
 */
import type { ReactNode } from "react";

import Skeleton from "@/components/ui/Skeleton";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import { Link } from "@/i18n/navigation";
import type { useArcAccount } from "./useArcAccount";
import { BTN_PRIMARY } from "./shared";

const BTN_QUIET = "text-[13px] text-muted underline underline-offset-2 hover:text-cream disabled:opacity-60";

export default function AccountGate({ account, children }: { account: ReturnType<typeof useArcAccount>; children: ReactNode }) {
  const { wallet } = account;
  const sheet = useWalletSheet();
  if (!wallet.configured) return <p className="m-0 text-[14px] text-muted">Arc accounts are not configured on this site yet.</p>;
  if (wallet.restoring) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (wallet.session) {
    // A link that failed right after the passkey was made (e.g. invite-only): say so here, the form is usable anyway.
    return (
      <>
        {wallet.error ? (
          <p role="alert" className="m-0 text-[13px] text-coral">
            {wallet.error} <Link href="/wallet" className="underline underline-offset-2">Finish on the wallet page</Link>
          </p>
        ) : null}
        {children}
      </>
    );
  }

  const busy = wallet.busy === "create" || wallet.busy === "login" ? "Follow your device's prompt…" : wallet.busy === "link" ? "Approve in your wallet, then your passkey…" : null;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-[14px] leading-relaxed text-muted">
        {wallet.solana
          ? "One-time setup: your device makes a passkey (Face ID, fingerprint or PIN), then your wallet signs once to link it. No seed phrase, no gas."
          : "Markets settle on Arc. Connect your wallet, and a passkey on this device becomes your Arc account (no seed phrase, no gas); or stake straight from an Arc wallet."}
      </p>
      {wallet.solana ? (
        <button type="button" disabled={Boolean(wallet.busy)} onClick={() => void wallet.create()} className={BTN_PRIMARY}>
          {busy ?? "Create my Arc account"}
        </button>
      ) : (
        <button type="button" onClick={sheet.open} onPointerEnter={sheet.warm} className={BTN_PRIMARY}>
          Connect wallet
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" disabled={Boolean(wallet.busy)} onClick={() => void wallet.login()} className={BTN_QUIET}>
          I already have a passkey
        </button>
        <Link href="/wallet" className={BTN_QUIET}>
          Arc wallet, Robinhood or recovery
        </Link>
      </div>
      {wallet.error ? (
        <p role="alert" className="m-0 text-[13px] text-coral">
          {wallet.error}
        </p>
      ) : null}
    </div>
  );
}
