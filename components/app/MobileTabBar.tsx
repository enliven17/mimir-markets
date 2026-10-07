"use client";

/**
 * The phone's bottom tab bar (below `lg`; the header pill takes over above):
 * Arena · Create · Portfolio · Council · More. "More" opens the shared Modal
 * sheet with every other page (NavMoreLinks), the same list the header's More
 * menu shows on desktop. Safe-area padded for the home bar; the page frame and
 * the body leave room for it (--tab-bar in app/globals.css).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleUserRound, Ellipsis, LayoutGrid, Plus, Users } from "lucide-react";

import { Link, usePathname } from "@/i18n/navigation";
import Modal from "@/components/ui/Modal";
import { NavMoreLinks } from "@/components/NavMoreMenu";
import { NAV_MORE, activeNavHref } from "@/components/nav-items";

const TABS = [
  { href: "/arena", label: (t: (k: string) => string) => t("items.arena.label"), Icon: LayoutGrid },
  { href: "/arena/create", label: (t: (k: string) => string) => t("items.create.short"), Icon: Plus },
  { href: "/dashboard", label: (t: (k: string) => string) => t("items.portfolio.label"), Icon: CircleUserRound },
  { href: "/council", label: (t: (k: string) => string) => t("items.council.label"), Icon: Users },
] as const;

const TAB =
  "press flex min-h-[52px] flex-1 select-none flex-col items-center justify-center gap-1 rounded-xl text-[11px] leading-none transition-colors";

export default function MobileTabBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const active = activeNavHref(pathname);
  const moreActive = NAV_MORE.some((i) => i.href === active);

  return (
    <>
      <nav aria-label={t("tabs")} className="tab-bar lg:hidden">
        {TABS.map(({ href, label, Icon }) => {
          const isActive = active === href;
          return (
            <Link key={href} href={href} aria-current={isActive ? "page" : undefined} className={`${TAB} ${isActive ? "text-coral" : "text-muted"}`}>
              <Icon size={20} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
              {label(t)}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          aria-expanded={more}
          className={`${TAB} ${moreActive || more ? "text-coral" : "text-muted"}`}
        >
          <Ellipsis size={20} aria-hidden />
          {t("more")}
        </button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title={t("moreTitle")} variant="sheet" closeLabel={t("closeMore")}>
        <NavMoreLinks onNavigate={() => setMore(false)} compact />
      </Modal>
    </>
  );
}
