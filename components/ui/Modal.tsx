"use client";

import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { setScrollLocked } from "@/lib/motion";

const SWIPE_CLOSE_PX = 110;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex="-1"])';

/**
 * Dialog base: dimmed backdrop, deep glass
 * dialog `rounded-3xl` with shadow-modal and a 30px round close button.
 *
 * - `variant="dialog"`: centred card, max 460px.
 * - `variant="sheet"`: bottom sheet on phones, centred on wider screens; use
 *   it for the wallet sheet, filters and "manage" flows. On phones it has a
 *   grab handle and follows the finger: dragged down from the top past
 *   SWIPE_CLOSE_PX it closes, short of that it springs back.
 *
 * Accessibility: `role="dialog"` + `aria-modal`, labelled by the title, Esc
 * and backdrop click close, focus is trapped inside and returned to the
 * opener on close. Lenis is paused while open and the body is marked with
 * `data-lenis-prevent` so the dialog scrolls natively.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  variant = "dialog",
  closeLabel = "Close",
  className = "",
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "dialog" | "sheet";
  closeLabel?: string;
  className?: string;
  /** Selector inside the dialog to focus first (defaults to the first focusable). */
  initialFocus?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // Wait for the portal: a Modal first mounted with open=true renders nothing
    // on its first pass, and without this the dialog would never get focus or a trap.
    if (!open || !mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    setScrollLocked(true);
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const first =
      (initialFocus ? dialog?.querySelector<HTMLElement>(initialFocus) : null) ??
      dialog?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialog;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = prevOverflow;
      setScrollLocked(false);
      opener?.focus?.();
    };
  }, [open, mounted, initialFocus]);

  if (!mounted || !open) return null;

  const isSheet = variant === "sheet";
  const setY = (dy: number, animate: boolean) => {
    const el = dialogRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.22,1,0.36,1)" : "none";
    el.style.transform = dy ? `translateY(${dy}px)` : "";
  };
  const swipe = isSheet
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          drag.current = dialogRef.current && dialogRef.current.scrollTop <= 0 ? { y: e.touches[0].clientY, dy: 0 } : null;
        },
        onTouchMove: (e: React.TouchEvent) => {
          if (!drag.current) return;
          drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y);
          setY(drag.current.dy, false);
        },
        onTouchEnd: () => {
          const dy = drag.current?.dy ?? 0;
          drag.current = null;
          if (dy > SWIPE_CLOSE_PX) onClose();
          else setY(0, true);
        },
      }
    : {};

  return createPortal(
    <div
      className={`fixed inset-0 z-[90] grid bg-[rgb(3_1_2/.42)] p-5 motion-safe:animate-[modal-in_160ms_ease-out_both] ${
        isSheet ? "place-items-end pb-0 sm:place-items-center sm:pb-5" : "place-items-center"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-lenis-prevent
        {...swipe}
        className={`glass-deep w-full overflow-y-auto bg-[rgb(14_7_9/.91)] p-[26px] shadow-modal outline-none motion-safe:animate-[sheet-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] ${
          isSheet
            ? "max-h-[min(88dvh,720px)] rounded-t-3xl pb-[calc(26px+env(safe-area-inset-bottom))] sm:max-w-[520px] sm:rounded-3xl sm:pb-[26px]"
            : "max-h-[min(620px,calc(100dvh-40px))] max-w-[460px] rounded-3xl"
        } ${className}`}
      >
        {isSheet ? <div aria-hidden className="sheet-handle sm:hidden" /> : null}
        <div className="flex items-center justify-between gap-5">
          <h2 id={titleId} className="m-0 text-left text-[1.55rem] leading-none">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="press grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-panel-raised text-muted transition-colors hover:text-cream"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="pt-4 text-left">{children}</div>
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
