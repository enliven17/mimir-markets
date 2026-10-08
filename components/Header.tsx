"use client";

/**
 * Header: morphing glass nav.
 *
 * One CSS variable, `--nav-p` (0 → 1), drives every property of the bar (see
 * `.nav-shell` in app/globals.css). On `/` it is scrubbed over the first
 * 160px of scroll, so the docked, transparent bar becomes a floating glass
 * pill; on every other route it is held at 1. Reduced motion flips it at 80px
 * without a scrub. It never hides on scroll.
 *
 * Pill: wordmark, Arena · Council · Portfolio · More (centred), then Create,
 * notifications and the wallet chip. Below `lg` the bar keeps only the
 * wordmark, notifications and the wallet chip: every page is in the bottom tab
 * bar and its More sheet (components/app/MobileTabBar.tsx), like an app.
 */
import { useRef } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/motion";
import Wordmark from "@/components/ui/Wordmark";
import NotificationBell from "./NotificationBell";
import NavMoreMenu from "./NavMoreMenu";
import { NAV_CTA, NAV_PRIMARY, activeNavHref } from "./nav-items";

// The chip reads the wallet (window-only); the placeholder keeps the bar from shifting.
const WalletChip = dynamic(() => import("./wallet/WalletChip"), {
  ssr: false,
  loading: () => <span aria-hidden className="inline-block h-9 w-[104px] rounded-full bg-cream/5" />,
});

export default function Header() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const shellRef = useRef<HTMLElement>(null);
  const isHome = pathname === "/";
  const active = activeNavHref(pathname);

  // Entrance, once per page load: the bar drops in, then its contents settle.
  // fromTo with explicit end states so a remount mid-flight never strands it.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline({ delay: 0.1 })
          .fromTo(".nav-bar", { yPercent: -140, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.1, ease: "expo.out" })
          .fromTo(
            ".nav-stagger",
            { y: -14, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.8, ease: "expo.out", stagger: 0.06, clearProps: "transform,opacity" },
            "-=0.75",
          );
      });
      return () => mm.revert();
    },
    { scope: shellRef },
  );

  // The morph. Home scrubs --nav-p with scroll; app routes hold the pill.
  useGSAP(
    () => {
      const el = shellRef.current;
      if (!el) return;
      if (!isHome) {
        el.style.setProperty("--nav-p", "1");
        return;
      }
      const p = { v: 0 };
      const set = () => el.style.setProperty("--nav-p", p.v.toFixed(4));
      set();
      const mm = gsap.matchMedia();
      mm.add(
        { motion: "(prefers-reduced-motion: no-preference)", reduce: "(prefers-reduced-motion: reduce)" },
        (ctx) => {
          if (ctx.conditions?.reduce) {
            const st = ScrollTrigger.create({
              start: 80,
              end: "max",
              onToggle: (self) => {
                p.v = self.isActive ? 1 : 0;
                set();
              },
            });
            p.v = st.isActive ? 1 : 0;
            set();
            return;
          }
          gsap.to(p, { v: 1, ease: "none", onUpdate: set, scrollTrigger: { start: 0, end: 160, scrub: 0.6 } });
        },
      );
      return () => mm.revert();
    },
    { dependencies: [isHome], revertOnUpdate: true },
  );

  const linkClass = (isActive: boolean) => `nav-link nav-stagger ${isActive ? "is-active" : ""}`;

  return (
    <header ref={shellRef} className="nav-shell" data-home={isHome || undefined}>
      <nav aria-label={t("main")} className="nav-bar">
        <Link href="/" aria-label={t("home")} className="nav-stagger justify-self-start rounded-xs">
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-[calc(24px-var(--nav-p)*6px)] lg:flex">
          {NAV_PRIMARY.map((item) => {
            const isActive = active === item.href;
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={isActive ? "page" : undefined} className={linkClass(isActive)}>
                  {t(`items.${item.key}.label`)}
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                </Link>
              </li>
            );
          })}
          <li>
            <NavMoreMenu triggerClassName="nav-link nav-stagger" />
          </li>
        </ul>

        <div className="col-start-2 flex items-center justify-self-end gap-2 lg:col-start-3">
          <Link
            href={NAV_CTA.href}
            aria-current={active === NAV_CTA.href ? "page" : undefined}
            className="nav-cta nav-stagger hidden lg:inline-flex"
          >
            <Plus size={15} aria-hidden />
            {t("items.create.short")}
          </Link>
          <span className="nav-stagger">
            <NotificationBell />
          </span>
          <span className="nav-stagger">
            <WalletChip />
          </span>
        </div>
      </nav>

    </header>
  );
}
