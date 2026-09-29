"use client";

/**
 * "More" disclosure for the desktop nav row. A button with aria-expanded that
 * opens a framed panel of grouped links.
 * Keyboard: Enter/Space/ArrowDown opens and focuses the first link,
 * ArrowUp/ArrowDown/Home/End move between links, Escape closes and returns
 * focus to the button, and tabbing out or clicking outside closes it.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { NAV_MORE, NAV_MORE_GROUPS, isNavActive } from "./nav-items";

export default function NavMoreMenu({ triggerClassName }: { triggerClassName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const activeItem = NAV_MORE.find((item) => isNavActive(pathname, item));

  const links = () => Array.from(panelRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []);

  const focusLink = (index: number) => {
    const all = links();
    if (!all.length) return;
    all[(index + all.length) % all.length].focus();
  };

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, close]);

  const openAndFocus = (index: number) => {
    setOpen(true);
    // The panel renders on the next frame.
    requestAnimationFrame(() => focusLink(index));
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openAndFocus(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAndFocus(-1);
    }
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = links();
    const current = all.indexOf(document.activeElement as HTMLAnchorElement);
    const moves: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: all.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      focusLink(moves[e.key]);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onButtonKey}
        className={`${triggerClassName} inline-flex items-center gap-1.5 ${
          open || activeItem
            ? "border-pv-border/40 bg-pv-border/[0.06] text-pv-text"
            : "border-transparent text-pv-muted hover:border-pv-border/25 hover:text-pv-text"
        }`}
      >
        More
        <ChevronDown
          size={13}
          aria-hidden
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        onKeyDown={onPanelKey}
        className="absolute left-1/2 top-[calc(100%+13px)] z-50 w-[560px] -translate-x-1/2 border border-pv-border/25 bg-pv-bg shadow-[0_24px_48px_-24px_rgb(var(--pv-border)/0.45)]"
      >
        <div className="grid grid-cols-3 gap-px bg-pv-border/15">
          {NAV_MORE_GROUPS.map((group) => (
            <div key={group.label} className="bg-pv-bg p-2">
              <p className="px-3 pb-1.5 pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => {
                  const active = isNavActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={`block border border-transparent px-3 py-2.5 transition-colors focus-ring ${
                          active ? "bg-pv-border/[0.06]" : "hover:border-pv-border/15 hover:bg-pv-surface"
                        }`}
                      >
                        <span
                          className={`block whitespace-nowrap font-mono text-[13px] font-medium ${
                            active ? "text-pv-emerald" : "text-pv-text"
                          }`}
                        >
                          {item.label}
                        </span>
                        {item.hint && (
                          <span className="mt-1 block font-mono text-[11px] leading-snug text-pv-muted">
                            {item.hint}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
