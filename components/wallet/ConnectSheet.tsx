"use client";

/**
 * Connect sheet in the glass look, following Family ConnectKit's flow.
 *
 * - Detected wallets first (Wallet Standard, `Installed`), then wallets that
 *   can load on demand (`Loadable`: Mobile Wallet Adapter on Android,
 *   WalletConnect when configured), each with the adapter's own icon.
 * - "Not installed": Phantom, Solflare and Backpack install links for the
 *   ones this browser does not have. Shown open until a wallet is installed,
 *   behind "I don't have a wallet" otherwise.
 * - Phones without an injected wallet (iOS Safari, Android Chrome): "Open in
 *   Phantom / Solflare" browse deep links that reopen this page inside the
 *   wallet's browser, where autoConnect picks the wallet up.
 * - Per-row connecting state, error state with retry, a shake on rejection;
 *   the sheet closes once the wallet is connected.
 *
 * Keyboard, focus trap, Esc, aria-modal and pausing Lenis come from Modal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, ChevronDown, RotateCcw } from "lucide-react";

import Modal from "@/components/ui/Modal";
import { isUserRejection, onWalletError } from "@/lib/solana/wallet-events";
import {
  isReady,
  useMimirWallet,
  WalletReadyState,
  type MimirWalletOption,
  type WalletName,
} from "@/hooks/useMimirWallet";

type RowError = { name: string; kind: "rejected" | "notReady" | "failed" };

interface KnownWallet {
  name: string;
  icon: string;
  install: string;
  /** Browse deep link that opens `url` inside the wallet's in-app browser. */
  browse?: (url: string, origin: string) => string;
}

const KNOWN_WALLETS: readonly KnownWallet[] = [
  {
    name: "Phantom",
    icon: "/wallets/phantom.svg",
    install: "https://phantom.com/download",
    browse: (url, origin) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`,
  },
  {
    name: "Solflare",
    icon: "/wallets/solflare.svg",
    install: "https://solflare.com/download",
    browse: (url, origin) =>
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`,
  },
  { name: "Backpack", icon: "/wallets/backpack.svg", install: "https://backpack.app/download" },
];

type Platform = { mobile: boolean; ios: boolean };

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return { mobile: false, ios: false };
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return { ios, mobile: ios || /Android|Mobile/i.test(ua) };
}

const rowClass =
  "group flex min-h-[58px] w-full items-center gap-3.5 rounded-2xl bg-cream/[0.04] px-3.5 py-2.5 text-left transition-[background-color,transform] duration-200 ease-out hover:bg-panel-raised focus-visible:bg-panel-raised active:scale-[.985] disabled:cursor-wait";

function WalletIcon({ src, name }: { src: string | undefined; name: string }) {
  if (!src) {
    return (
      <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-md bg-panel-2 font-display text-lg text-cream">
        {name.slice(0, 1)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- adapter icons are data URIs
  return <img src={src} alt="" width={36} height={36} className="h-9 w-9 flex-none rounded-md" />;
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-coral/25 border-t-coral"
    />
  );
}

export default function ConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("wallet");
  const { wallets, wallet, select, connect, connected, connecting } = useMimirWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<RowError | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [platform, setPlatform] = useState<Platform>({ mobile: false, ios: false });
  const [page, setPage] = useState({ url: "", origin: "" });
  const sawConnecting = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    if (!open) return;
    setPage({ url: window.location.href, origin: window.location.origin });
    setError(null);
    setPending(null);
    setShowInstall(false);
  }, [open]);

  // Connected: done.
  useEffect(() => {
    if (open && connected) {
      setPending(null);
      onClose();
    }
  }, [open, connected, onClose]);

  // The attempt ended without a connection and without an error event
  // (the user closed the wallet popup): clear the row so it can be retried.
  useEffect(() => {
    if (!pending) return;
    if (connecting) {
      sawConnecting.current = true;
      return;
    }
    if (sawConnecting.current && !connected) {
      sawConnecting.current = false;
      setPending(null);
    }
  }, [pending, connecting, connected]);

  useEffect(
    () =>
      onWalletError((err, adapter) => {
        const name = adapter?.name ?? pendingRef.current;
        if (!name) return;
        const kind: RowError["kind"] = isUserRejection(err)
          ? "rejected"
          : err.name === "WalletNotReadyError"
            ? "notReady"
            : "failed";
        if (kind !== "rejected") console.error("Wallet connect failed:", err);
        setPending(null);
        setError({ name, kind });
      }),
    [],
  );

  const detected = useMemo(
    () =>
      wallets
        .filter(isReady)
        .sort((a, b) => Number(b.readyState === WalletReadyState.Installed) - Number(a.readyState === WalletReadyState.Installed)),
    [wallets],
  );
  const hasInstalled = detected.some((w) => w.readyState === WalletReadyState.Installed);
  const detectedNames = new Set(detected.map((w) => w.adapter.name.toLowerCase()));
  const missing = KNOWN_WALLETS.filter((w) => !detectedNames.has(w.name.toLowerCase()));
  const browseable = platform.mobile && !hasInstalled ? KNOWN_WALLETS.filter((w) => w.browse) : [];
  // Loadable-only options (WalletConnect, Mobile Wallet Adapter) do not count
  // as having a wallet: keep the install links in view until one is installed.
  const installOpen = showInstall || !hasInstalled;

  const choose = (option: MimirWalletOption) => {
    const name = option.adapter.name;
    setError(null);
    setPending(name);
    sawConnecting.current = false;
    if (wallet?.adapter.name === name) {
      // Already selected (an earlier attempt): connect directly. Errors
      // arrive through onWalletError.
      connect().catch(() => undefined);
    } else {
      // autoConnect connects as soon as the selection lands.
      select(name as WalletName);
    }
  };

  const statusLabel = (option: MimirWalletOption) =>
    option.readyState === WalletReadyState.Installed ? t("detected") : t("ready");

  return (
    <Modal open={open} onClose={onClose} title={t("sheetTitle")} variant="sheet" closeLabel={t("close")}>
      <p className="text-[14px] leading-snug text-muted">{t("sheetLead")}</p>

      {browseable.length > 0 ? (
        <section aria-labelledby="wallet-open-in" className="mt-5">
          <h3 id="wallet-open-in" className="mb-2 text-[12px] uppercase tracking-[0.06em] text-muted">
            {t("openInTitle")}
          </h3>
          <p className="mb-3 text-[13px] leading-snug text-muted">{t("openInLead")}</p>
          <ul className="grid gap-2">
            {browseable.map((w) => (
              <li key={w.name}>
                <a href={w.browse!(page.url, page.origin)} className={rowClass} rel="noreferrer">
                  <WalletIcon src={w.icon} name={w.name} />
                  <span className="min-w-0 flex-1 font-display text-[1.2rem] leading-none text-cream">
                    {t("openIn", { wallet: w.name })}
                  </span>
                  <ArrowUpRight size={16} aria-hidden className="text-coral" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detected.length > 0 ? (
        <section aria-labelledby="wallet-detected" className="mt-5">
          <h3 id="wallet-detected" className="mb-2 text-[12px] uppercase tracking-[0.06em] text-muted">
            {t("detectedTitle")}
          </h3>
          <ul className="grid gap-2" aria-live="polite">
            {detected.map((option) => {
              const name = option.adapter.name;
              const isPending = pending === name;
              const rowError = error?.name === name ? error : null;
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => choose(option)}
                    disabled={Boolean(pending) && !isPending}
                    aria-busy={isPending || undefined}
                    className={`${rowClass} ${rowError?.kind === "rejected" ? "wallet-denied" : ""}`}
                  >
                    <WalletIcon src={option.adapter.icon} name={name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[1.2rem] leading-none text-cream">{name}</span>
                      <span
                        className={`mt-1 block text-[12px] leading-snug ${rowError ? "text-danger" : "text-muted"}`}
                      >
                        {isPending
                          ? t("approve", { wallet: name })
                          : rowError
                            ? t(rowError.kind, { wallet: name })
                            : statusLabel(option)}
                      </span>
                    </span>
                    {isPending ? (
                      <Spinner />
                    ) : rowError ? (
                      <span className="flex items-center gap-1 text-[12px] text-coral">
                        <RotateCcw size={13} aria-hidden />
                        {t("retry")}
                      </span>
                    ) : option.readyState === WalletReadyState.Installed ? (
                      <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-full bg-coral shadow-[0_0_7px_rgb(255_81_72/.58)]" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="mt-5 rounded-2xl border border-dashed border-cream/25 px-4 py-4 text-[14px] text-muted">
          {t("noneDetected")}
        </p>
      )}

      {missing.length > 0 ? (
        <section aria-labelledby="wallet-install" className="mt-5">
          {hasInstalled ? (
            <button
              type="button"
              id="wallet-install"
              aria-expanded={installOpen}
              aria-controls="wallet-install-list"
              onClick={() => setShowInstall((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-xs py-1 text-left text-[13px] text-muted transition-colors hover:text-cream"
            >
              {t("noWalletToggle")}
              <ChevronDown
                size={14}
                aria-hidden
                className={`text-coral transition-transform duration-200 ${installOpen ? "rotate-180" : ""}`}
              />
            </button>
          ) : (
            <h3 id="wallet-install" className="mb-2 text-[12px] uppercase tracking-[0.06em] text-muted">
              {t("notInstalledTitle")}
            </h3>
          )}
          {installOpen ? (
            <ul id="wallet-install-list" className={`grid gap-2 ${hasInstalled ? "mt-2" : ""}`}>
              {missing.map((w) => (
                <li key={w.name}>
                  <a
                    href={w.install}
                    target="_blank"
                    rel="noreferrer"
                    className={rowClass}
                    aria-label={t("installAria", { wallet: w.name })}
                  >
                    <WalletIcon src={w.icon} name={w.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[1.2rem] leading-none text-cream">{w.name}</span>
                      <span className="mt-1 block text-[12px] text-muted">{t("notInstalled")}</span>
                    </span>
                    <span className="flex items-center gap-1 text-[13px] text-coral">
                      {t("install")}
                      <ArrowUpRight size={14} aria-hidden />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <p className="mt-6 flex items-center gap-2 text-[12px] text-muted">
        <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-coral" />
        {t("footnote")}
      </p>
    </Modal>
  );
}
