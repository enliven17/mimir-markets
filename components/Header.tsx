"use client";

/**
 * Mimir header — Solana-native, blueprint frame.
 * The bar sits on the same column as the page rails (border-x lines up with
 * PageFrame), so the rails read as running straight through the navbar.
 * Full nav row from `xl` up; below that a framed menu sheet. Wallet
 * connection is @solana/wallet-adapter (WalletMultiButton); no EVM anywhere.
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Link, usePathname } from "@/i18n/navigation";
import { Menu, Plus, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { NAV_CTA, NAV_ITEMS, isNavActive } from "./nav-items";

// wallet-adapter button is client-only (touches window) — load without SSR.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

const chipBase =
  "whitespace-nowrap border px-3 py-1.5 font-mono text-[12px] font-medium transition-colors focus-ring";

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
          className={`flex h-14 min-w-0 items-center justify-between gap-3 border-x border-b px-4 transition-[background-color,border-color] duration-300 ease-out sm:px-6 ${
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

          {/* Desktop nav (wide screens) */}
          <div className="hidden min-w-0 items-center gap-2 xl:flex">
            {NAV_ITEMS.map((item) => {
              const active = isNavActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`${chipBase} ${
                    active
                      ? "border-pv-border/40 bg-pv-border/[0.06] text-pv-text"
                      : "border-transparent text-pv-muted hover:border-pv-border/25 hover:text-pv-text"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <span className="mx-1 h-6 w-px bg-pv-border/25" aria-hidden />
            <ThemeToggle />
            <Link
              href={NAV_CTA.href}
              aria-current={ctaActive ? "page" : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap border border-pv-emerald bg-pv-emerald px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-pv-bg transition-[filter] hover:brightness-110 focus-ring ${
                ctaActive ? "ring-2 ring-pv-emerald/40 ring-offset-2 ring-offset-pv-bg" : ""
              }`}
            >
              <Plus size={13} aria-hidden />
              {NAV_CTA.label}
            </Link>
            <WalletMultiButton />
          </div>

          {/* Compact controls (below xl) */}
          <div className="flex shrink-0 items-center gap-2 xl:hidden">
            <ThemeToggle />
            <div className="hidden sm:block">
              <WalletMultiButton />
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
            className="border-x border-b border-pv-border/25 bg-pv-bg/95 backdrop-blur-[14px] xl:hidden"
          >
            <div className="grid gap-px bg-pv-border/25 sm:grid-cols-2">
              {NAV_ITEMS.map((item) => {
                const active = isNavActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between bg-pv-bg px-5 py-3.5 font-mono text-sm transition-colors focus-ring ${
                      active
                        ? "text-pv-emerald"
                        : "text-pv-text/85 hover:bg-pv-surface hover:text-pv-text"
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
            <div className="flex flex-col gap-3 border-t border-pv-border/25 p-4 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href={NAV_CTA.href}
                className="flex items-center justify-center gap-1.5 border border-pv-emerald bg-pv-emerald px-3 py-2.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-pv-bg focus-ring"
              >
                <Plus size={13} aria-hidden />
                {NAV_CTA.mobileLabel}
              </Link>
              <div className="sm:hidden">
                <WalletMultiButton />
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
