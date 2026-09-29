"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export type ListboxFieldOption = { value: string; label: string };

export type ListboxFieldProps = {
  /** id estable para accesibilidad (sin espacios) */
  id: string;
  label: string;
  value: string;
  options: ListboxFieldOption[];
  onChange: (value: string) => void;
  /** Si el botón necesita aria-label distinto del texto visible */
  ariaLabel?: string;
};

/**
 * Desplegable estilo Explorer (SORT BY): trigger tipo `input` + panel listbox con portal
 * para no quedar recortado bajo `overflow-hidden` (p. ej. GlassCard).
 */
export default function ListboxField({
  id,
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: ListboxFieldProps) {
  const reactId = useId();
  const baseId = `${id}-${reactId.replace(/:/g, "")}`;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";

  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: r.left,
      width: r.width,
    });
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollResize = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open, updatePos]);

  const listboxId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const triggerId = `${baseId}-trigger`;

  const panel =
    mounted &&
    typeof document !== "undefined" &&
    open &&
    pos &&
    createPortal(
      <div
        ref={menuRef}
        data-lenis-prevent
        id={listboxId}
        role="listbox"
        aria-labelledby={labelId}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 80,
        }}
        className="pop-in grid max-h-[60vh] gap-[3px] overflow-y-auto rounded-md bg-panel p-[5px] shadow-menu"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={value === opt.value}
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            className={`flex min-h-[38px] w-full items-center rounded-sm px-2.5 text-left font-body text-[14px] transition-colors ${
              value === opt.value
                ? "bg-panel-raised text-cream"
                : "text-muted hover:bg-panel-raised hover:text-cream focus-visible:bg-panel-raised"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>,
      document.body
    );

  return (
    <div ref={wrapRef} className="min-w-0 space-y-2">
      <label id={labelId} htmlFor={triggerId} className="block text-[12px] uppercase tracking-[0.06em] text-muted">
        {label}
      </label>
      <button
        type="button"
        id={triggerId}
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => setOpen((o) => !o)}
        className="input flex h-11 min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 py-0 pr-4 text-left font-body text-sm text-cream"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-coral transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {panel}
    </div>
  );
}
