"use client";

/**
 * Header wallet chip (`.wallet-chip` / `.wallet-menu`). Disconnected: a glass "Connect" pill that opens the
 * connect sheet. Connected: the short address in mono with a chevron; the
 * menu holds the wallet's devnet balances, its token tier (moved here from
 * the header), copy address, explorer, "Manage balance" and disconnect.
 *
 * Keyboard: the menu opens on Enter/Space/ArrowDown and focuses its first
 * item, arrows move between items, Esc closes and returns focus to the chip,
 * tabbing out or clicking outside closes it.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { associatedTokenAddress } from "@/lib/solana/ata";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Check, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { USDC_MINT } from "@/lib/solana/config";
import { formatUsdcUnitsBare } from "@/lib/money";
import { useHolderTier } from "@/components/token/useHolderTier";
import { useWalletSheet } from "./WalletSheetProvider";

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type Balances = { sol: number | null; usdcUnits: bigint | null };

const menuItem =
  "flex min-h-[38px] w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-[13px] text-muted transition-colors hover:bg-panel-raised hover:text-cream focus-visible:bg-panel-raised focus-visible:text-cream focus-visible:outline-none";

export default function WalletChip({ className = "" }: { className?: string }) {
  const t = useTranslations("wallet");
  const tt = useTranslations("token");
  const { publicKey, connected, connecting, wallet, disconnect, connection } = useMimirWallet();
  const { open: openSheet, warm: warmSheet } = useWalletSheet();
  const { state: tier } = useHolderTier();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [balances, setBalances] = useState<Balances>({ sol: null, usdcUnits: null });
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const address = publicKey?.toBase58() ?? null;

  const close = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) chipRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!connected) setMenuOpen(false);
  }, [connected]);

  // Balances are read when the menu opens, not polled from the header.
  useEffect(() => {
    if (!menuOpen || !publicKey) return;
    let cancelled = false;
    const ata = associatedTokenAddress(USDC_MINT, publicKey);
    Promise.all([
      connection
        .getBalance(publicKey)
        .then((n) => n / LAMPORTS_PER_SOL)
        .catch(() => null),
      connection
        .getTokenAccountBalance(ata)
        .then((r) => BigInt(r.value.amount))
        .catch((err) => (String(err).includes("could not find account") ? 0n : null)),
    ]).then(([sol, usdcUnits]) => {
      if (!cancelled) setBalances({ sol, usdcUnits });
    });
    return () => {
      cancelled = true;
    };
  }, [menuOpen, publicKey, connection]);

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

  const tierLabel = tier && tier.tier !== "none" ? tt(`tier.${tier.tier}`) : null;
  const explorer = `https://explorer.solana.com/address/${address}?cluster=devnet`;

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
        aria-label={t("chipAria", { address: shortAddress(address), wallet: wallet?.adapter.name ?? "" })}
        // Enter / Space (detail 0) land on the first item, as a menu button should; a click keeps focus on the chip.
        onClick={(e) => (menuOpen ? close(false) : openMenu(e.detail === 0 ? 0 : null))}
        onKeyDown={onChipKey}
        className="wallet-chip is-connected press"
      >
        {wallet?.adapter.icon ? (
          // eslint-disable-next-line @next/next/no-img-element -- adapter icons are data URIs
          <img src={wallet.adapter.icon} alt="" width={16} height={16} className="h-4 w-4 rounded-[4px]" />
        ) : null}
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
              {t("devnet")}
              {tierLabel ? (
                <Link
                  href="/token"
                  data-menu-item
                  title={tt("chipTitle")}
                  onClick={() => close(false)}
                  className="rounded-full bg-red/[0.14] px-2 py-0.5 normal-case tracking-normal text-pending"
                >
                  {tierLabel}
                </Link>
              ) : null}
            </p>
            <p className="mt-1 break-all font-mono text-[12px] leading-snug text-cream/80">{address}</p>
            <dl className="mt-2.5 grid grid-cols-2 gap-2 rounded-[14px] bg-cream/[0.035] p-2.5">
              <div>
                <dt className="text-[11px] text-muted">{t("usdc")}</dt>
                <dd className="font-mono text-[14px] tabular-nums text-cream">
                  {balances.usdcUnits === null ? "…" : formatUsdcUnitsBare(balances.usdcUnits)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">{t("sol")}</dt>
                <dd className="font-mono text-[14px] tabular-nums text-cream">
                  {balances.sol === null ? "…" : balances.sol.toFixed(balances.sol < 1 ? 4 : 3)}
                </dd>
              </div>
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
          <Link href="/dashboard" role="menuitem" data-menu-item className={menuItem} onClick={() => close(false)}>
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
