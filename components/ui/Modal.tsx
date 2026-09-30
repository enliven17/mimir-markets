"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { setScrollLocked } from "@/lib/motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog base: dimmed backdrop, deep glass
 * dialog `rounded-3xl` with shadow-modal and a 30px round close button.
 *
 * - `variant="dialog"`: centred card, max 460px.
 * - `variant="sheet"`: bottom sheet on phones, centred on wider screens; use
 *   it for the wallet sheet, filters and "manage" flows.
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

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
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
  }, [open, initialFocus]);

  if (!mounted || !open) return null;

  const isSheet = variant === "sheet";

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
        className={`glass-deep w-full overflow-y-auto bg-[rgb(14_7_9/.91)] p-[26px] shadow-modal outline-none motion-safe:animate-[sheet-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] ${
          isSheet
            ? "max-h-[min(88dvh,720px)] rounded-t-3xl sm:max-w-[520px] sm:rounded-3xl"
            : "max-h-[min(620px,calc(100dvh-40px))] max-w-[460px] rounded-3xl"
        } ${className}`}
      >
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
