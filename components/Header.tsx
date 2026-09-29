"use client";

/**
 * Mimir header — Solana-native, blueprint frame.
 * The bar sits on the same column as the page rails (border-x lines up with
 * PageFrame), so the rails read as running straight through the navbar.
 *
 * From `lg` up: logo, the primary links, a "More" menu for the rest, then the
 * controls (tier, notifications, theme, Publish, wallet). Publish collapses to
 * its icon between lg and xl so the row never overflows at 1024–1279.
 * Below `lg`: a framed menu sheet listing every link, grouped.
 * Wallet connection is @solana/wallet-adapter; no EVM anywhere.
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Link, usePathname } from "@/i18n/navigation";
import { Menu, Plus, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell";
import TierChip from "./token/TierChip";
import NavMoreMenu from "./NavMoreMenu";
import { NAV_CTA, NAV_PRIMARY, NAV_SHEET_GROUPS, isNavActive } from "./nav-items";

// wallet-adapter button is client-only (touches window) — load without SSR.
// The placeholder keeps the bar from shifting while it loads.
const WalletButton = dynamic(() => import("./WalletButton"), {
  ssr: false,
  loading: () => <span aria-hidden className="inline-block h-[34px] w-[98px] border border-pv-emerald/40" />,
});

const linkBase =
  "whitespace-nowrap border px-3 py-1.5 font-mono text-[12.5px] font-medium transition-colors focus-ring";
const linkActive = "border-pv-border/40 bg-pv-border/[0.06] text-pv-text";
const linkIdle = "border-transparent text-pv-muted hover:border-pv-border/25 hover:text-pv-text";

export default function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isHome = pathname === "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const solid = scrolled || mobileOpen || !isHome;
  const ctaActive = pathname === NAV_CTA.href;

  return (
    <header className="fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <nav
          aria-label="Main"
          className={`flex h-14 min-w-0 items-center gap-4 border-x border-b px-4 transition-[background-color,border-color] duration-300 ease-out sm:px-5 xl:gap-6 ${
            solid
              ? "border-pv-border/25 bg-pv-bg/85 backdrop-blur-[14px]"
              : "border-x-pv-border/25 border-b-transparent bg-transparent"
          }`}
        >
          <Link href="/" className="flex shrink-0 items-center gap-2.5 focus-ring">
            <span className="group font-display text-lg font-bold tracking-tight text-pv-text sm:text-xl">
              Mimir
              <span
                className="ml-[1px] inline-block text-pv-emerald transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-125"
                aria-hidden
              >
                .
              </span>
            </span>
          </Link>

          {/* Desktop links (lg up) */}
          <div className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
            <span className="mr-2 h-6 w-px bg-pv-border/25 xl:mr-3" aria-hidden />
            {NAV_PRIMARY.map((item) => {
              const active = isNavActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`${linkBase} ${active ? linkActive : linkIdle}`}
                >
                  {item.label}
                </Link>
              );
            })}
            <NavMoreMenu triggerClassName={linkBase} />
          </div>

          {/* Desktop controls (lg up) */}
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <span className="hidden xl:contents">
              <TierChip />
            </span>
            <NotificationBell />
            <ThemeToggle />
            <Link
              href={NAV_CTA.href}
              aria-current={ctaActive ? "page" : undefined}
              aria-label={NAV_CTA.label}
              title={NAV_CTA.mobileLabel}
              className={`ml-1 flex h-[34px] items-center gap-1.5 whitespace-nowrap border border-pv-emerald/60 px-2.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald transition-colors hover:bg-pv-emerald/10 focus-ring xl:px-3 ${
                ctaActive ? "bg-pv-emerald/10" : ""
              }`}
            >
              <Plus size={14} aria-hidden />
              <span className="hidden xl:inline">{NAV_CTA.label}</span>
            </Link>
            <WalletButton />
          </div>

          {/* Compact controls (below lg) */}
          <div className="ml-auto flex shrink-0 items-center gap-2 lg:hidden">
            <TierChip />
            <NotificationBell />
            <ThemeToggle />
            <div className="hidden sm:block">
              <WalletButton />
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center border border-pv-border/25 text-pv-text transition-colors hover:border-pv-emerald/50 hover:text-pv-emerald focus-ring"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </nav>

        {mobileOpen && (
          <div
            id="mobile-nav"
            className="max-h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] overflow-y-auto border-x border-b border-pv-border/25 bg-pv-bg/95 backdrop-blur-[14px] lg:hidden"
          >
            {NAV_SHEET_GROUPS.map((group) => (
              <section key={group.label} aria-label={group.label} className="border-b border-pv-border/25 last:border-b-0">
                <p className="px-5 pb-2 pt-4 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                  {group.label}
                </p>
                <div className="grid gap-px border-t border-pv-border/15 bg-pv-border/15 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const active = isNavActive(pathname, item);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center justify-between bg-pv-bg px-5 py-3.5 font-mono text-sm transition-colors focus-ring ${
                          active ? "text-pv-emerald" : "text-pv-text/85 hover:bg-pv-surface hover:text-pv-text"
                        }`}
                      >
                        {item.label}
                        <span aria-hidden className={active ? "text-pv-emerald" : "text-pv-muted/60"}>
                          {active ? "●" : "→"}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
            <div className="flex flex-col gap-3 border-t border-pv-border/25 p-4 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href={NAV_CTA.href}
                className="flex items-center justify-center gap-1.5 border border-pv-emerald bg-pv-emerald px-3 py-2.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-pv-bg focus-ring"
              >
                <Plus size={13} aria-hidden />
                {NAV_CTA.mobileLabel}
              </Link>
              <div className="sm:hidden [&_.wallet-adapter-button-trigger]:w-full [&_.wallet-adapter-button-trigger]:justify-center [&_.wallet-adapter-dropdown]:w-full">
                <WalletButton />
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
