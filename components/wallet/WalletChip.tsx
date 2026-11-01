"use client";

/**
 * Header wallet chip (`.wallet-chip` / `.wallet-menu`). Disconnected: a glass "Connect" pill that opens the
 * connect sheet. Connected: the EVM wallet's short address in mono with a chevron; the menu holds its USDC on every
 * enabled market chain (Base first, with its ETH for gas), copy address, explorer, the wallet page and disconnect.
 *
 * Keyboard: the menu opens on Enter/Space/ArrowDown and focuses its first
 * item, arrows move between items, Esc closes and returns focus to the chip,
 * tabbing out or clicking outside closes it.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, LogOut, Wallet } from "@/components/icons";

import { Link } from "@/i18n/navigation";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { gasBalanceWei, usdcBalanceWei } from "@/lib/chains/client";
import { explorerUrl, MARKET_CHAINS, type MarketChainId } from "@/lib/chains/registry";
import { formatUsdcUnitsBare } from "@/lib/money";
import { useWalletSheet } from "./WalletSheetProvider";

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}


const menuItem =
  "flex min-h-[38px] w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-[13px] text-muted transition-colors hover:bg-panel-raised hover:text-cream focus-visible:bg-panel-raised focus-visible:text-cream focus-visible:outline-none";

export default function WalletChip({ className = "" }: { className?: string }) {
  const t = useTranslations("wallet");
  const { address, connected, connecting, networkName, disconnect } = useMimirWallet();
  const { open: openSheet, warm: warmSheet } = useWalletSheet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Per enabled chain: USDC in 6-dp units and, on Base, ETH in wei; null = not read yet. */
  const [balances, setBalances] = useState<Partial<Record<MarketChainId, { usdc: bigint | null; gas: bigint | null }>>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) chipRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!address) setMenuOpen(false);
  }, [address]);

  // The balance is read when the menu opens, not polled from the header.
  useEffect(() => {
    if (!menuOpen || !address) return;
    let cancelled = false;
    void Promise.all(
      MARKET_CHAINS.enabled.map(async (c) => {
        const cfg = MARKET_CHAINS.chains[c];
        const [usdc, gas] = await Promise.all([
          usdcBalanceWei(cfg, address).then((w) => w / 1_000_000_000_000n).catch(() => null),
          cfg.gas.symbol === "ETH" ? gasBalanceWei(cfg, address).catch(() => null) : Promise.resolve(null),
        ]);
        return [c, { usdc, gas }] as const;
      }),
    ).then((rows) => {
      if (!cancelled) setBalances(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [menuOpen, address]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, close]);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []);
  const focusItem = (index: number) => {
    const all = items();
    if (all.length) all[(index + all.length) % all.length].focus();
  };

  const openMenu = (focusIndex: number | null) => {
    setMenuOpen(true);
    if (focusIndex !== null) requestAnimationFrame(() => focusItem(focusIndex));
  };

  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openMenu(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(-1);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const current = all.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: all.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      focusItem(moves[e.key]);
    }
  };

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked: the address is still shown in the menu */
    }
  };

  if (!connected || !address) {
    return (
      <button
        type="button"
        onClick={openSheet}
        onPointerEnter={warmSheet}
        onFocus={warmSheet}
        aria-busy={connecting || undefined}
        className={`wallet-chip press ${className}`}
      >
        {connecting ? (
          <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-cream/25 border-t-cream" />
        ) : (
          <Wallet size={14} aria-hidden className="text-coral" />
        )}
        {connecting ? t("connecting") : t("connect")}
      </button>
    );
  }

  const explorer = explorerUrl(MARKET_CHAINS.chains[MARKET_CHAINS.defaultChain], "address", address);

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onBlur={(e) => {
        if (menuOpen && !rootRef.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-label={t("chipAria", { address: shortAddress(address), wallet: networkName ?? "EVM" })}
        // Enter / Space (detail 0) land on the first item, as a menu button should; a click keeps focus on the chip.
        onClick={(e) => (menuOpen ? close(false) : openMenu(e.detail === 0 ? 0 : null))}
        onKeyDown={onChipKey}
        className="wallet-chip is-connected press"
      >
        <span className="font-mono text-[13px] tabular-nums text-cream">{shortAddress(address)}</span>
        <svg viewBox="0 0 10 10" aria-hidden className="wallet-chip-chevron">
          <path d="M2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {menuOpen ? (
        <div ref={menuRef} onKeyDown={onMenuKey} className="wallet-menu">
          {/* Account summary above the menu: a menu may only hold menu items. */}
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.06em] text-muted">
              {networkName ? t("networkWallet", { network: networkName }) : t("evmWallet")}
            </p>
            <p className="mt-1 break-all font-mono text-[12px] leading-snug text-cream/80">{address}</p>
            <dl className="mt-2.5 grid gap-2 rounded-[14px] bg-cream/[0.035] p-2.5">
              {MARKET_CHAINS.enabled.map((c) => {
                const b = balances[c];
                return (
                  <div key={c}>
                    <dt className="text-[11px] text-muted">{t("usdcOn", { network: MARKET_CHAINS.chains[c].label })}</dt>
                    <dd className="font-mono text-[14px] tabular-nums text-cream">
                      {b?.usdc == null ? "…" : formatUsdcUnitsBare(b.usdc)}
                      {MARKET_CHAINS.chains[c].gas.symbol === "ETH" && b?.gas != null ? (
                        <span className="ml-2 text-[11px] text-muted">{(Number(b.gas) / 1e18).toFixed(5)} ETH</span>
                      ) : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
          <div id={menuId} role="menu" aria-label={t("menuLabel")} className="grid gap-[3px]">
          <button type="button" role="menuitem" data-menu-item onClick={copy} className={menuItem}>
            {copied ? <Check size={14} aria-hidden className="text-win" /> : <Copy size={14} aria-hidden />}
            {copied ? t("copied") : t("copy")}
          </button>
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            data-menu-item
            className={menuItem}
            onClick={() => close(false)}
          >
            <ExternalLink size={14} aria-hidden />
            {t("explorer")}
          </a>
          <Link href="/wallet" role="menuitem" data-menu-item className={menuItem} onClick={() => close(false)}>
            <Wallet size={14} aria-hidden />
            {t("manage")}
          </Link>
          <button
            type="button"
            role="menuitem"
            data-menu-item
            onClick={() => {
              close(true);
              void disconnect().catch(() => undefined);
            }}
            className={menuItem}
          >
            <LogOut size={14} aria-hidden />
            {t("disconnect")}
          </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
