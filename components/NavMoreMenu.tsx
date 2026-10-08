"use client";

/**
 * "More" in the header pill: one button that opens a sheet with every page
 * that is not in the pill, grouped. The sheet is the
 * shared Modal: focus moves to the first link, Tab stays inside, Esc or the
 * backdrop closes it and focus returns to the button, Lenis pauses while it
 * is open.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import Modal from "@/components/ui/Modal";
import { NAV_MORE, NAV_MORE_GROUPS, activeNavHref } from "./nav-items";

export function NavMoreLinks({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  const t = useTranslations("nav");
  const active = activeNavHref(usePathname());
  return (
    <div className={`grid gap-x-4 sm:grid-cols-2 ${compact ? "grid-cols-2 gap-y-4" : "gap-y-5"}`}>
      {NAV_MORE_GROUPS.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`nav-group-${group.key}`}
          data-web-only={group.items.every((i) => i.webOnly) || undefined}
        >
          <h3 id={`nav-group-${group.key}`} className="mb-1.5 px-3 text-[11px] uppercase tracking-[0.06em] text-muted">
            {t(`groups.${group.key}`)}
          </h3>
          <ul className="grid gap-1">
            {group.items.map((item) => {
              const isActive = active === item.href;
              return (
                <li key={item.href} data-web-only={item.webOnly || undefined}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onNavigate}
                    className={`group flex items-start justify-between gap-3 rounded-md px-3 py-2.5 transition-colors ${
                      isActive ? "bg-cream/[0.07]" : "hover:bg-panel-raised"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className={`block font-display text-[1.2rem] leading-none ${isActive ? "text-coral" : "text-cream"}`}>
                        {t(`items.${item.key}.label`)}
                      </span>
                      {compact ? null : (
                        <span className="mt-1 block text-[12px] leading-snug text-muted">{t(`items.${item.key}.hint`)}</span>
                      )}
                    </span>
                    <ArrowUpRight
                      size={14}
                      aria-hidden
                      className={`mt-0.5 flex-none transition-colors ${isActive ? "text-coral" : "text-dim group-hover:text-coral"}`}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function NavMoreMenu({ triggerClassName }: { triggerClassName: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = activeNavHref(pathname);
  const inMore = NAV_MORE.some((item) => item.href === active);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`${triggerClassName} ${inMore || open ? "is-active" : ""}`}
      >
        {t("more")}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("moreTitle")}
        variant="sheet"
        closeLabel={t("closeMore")}
        initialFocus="a[href]"
        className="sm:!max-w-[640px]"
      >
        <NavMoreLinks onNavigate={() => setOpen(false)} />
      </Modal>
    </>
  );
}
