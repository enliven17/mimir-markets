"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Docs sections. On desktop every section is open and a sticky table of
 * contents sits beside them; below `lg` they fold into an accordion with one
 * section open at a time. The body is hidden with `max-lg:hidden`, so the
 * server HTML already has the right layout for both widths (no shift on
 * hydrate). A `#id` in the URL opens that section.
 */
const Ctx = createContext<{ open: string; setOpen: (id: string) => void }>({ open: "", setOpen: () => {} });

export function DocsAccordion({ first, children }: { first: string; children: ReactNode }) {
  const [open, setOpenState] = useState(first);

  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && document.getElementById(id)?.hasAttribute("data-doc")) setOpenState(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const setOpen = (id: string) => {
    setOpenState((prev) => (prev === id ? "" : id));
    // The section above may have just folded: bring the opened header back into view.
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top < 72) el.scrollIntoView({ block: "start" });
    });
  };

  return (
    <Ctx.Provider value={{ open, setOpen }}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:gap-14">{children}</div>
    </Ctx.Provider>
  );
}

export function DocsSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  const { open, setOpen } = useContext(Ctx);
  const isOpen = open === id;
  return (
    <section
      id={id}
      data-doc
      aria-labelledby={`${id}-h`}
      className="scroll-mt-[96px] rounded-lg bg-[var(--glass-deep)] max-lg:px-4 max-lg:py-1 lg:bg-transparent"
    >
      <h2 id={`${id}-h`} className="m-0 font-display text-[1.45rem] leading-none text-cream lg:text-[2rem]">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={`${id}-body`}
          onClick={() => setOpen(id)}
          className="flex min-h-[52px] w-full items-center gap-3 text-left lg:hidden"
        >
          <span className="font-mono text-[12px] text-dim">{eyebrow}</span>
          <span className="min-w-0 flex-1">{title}</span>
          <span aria-hidden className={`text-coral transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges" fill="currentColor">
              <path d="M0 2h2v2h2v2h2V4h2V2h2v2H8v2H6v2H4V6H2V4H0z" />
            </svg>
          </span>
        </button>
        <span className="flex items-baseline gap-3 max-lg:hidden">
          <span className="font-mono text-[13px] text-dim">{eyebrow}</span>
          {title}
        </span>
      </h2>
      <div
        id={`${id}-body`}
        className={`grid grid-cols-[minmax(0,1fr)] gap-5 pb-4 pt-3 text-[15px] leading-relaxed text-cream/85 lg:pb-0 lg:pt-6 ${isOpen ? "" : "max-lg:hidden"}`}
      >
        {children}
      </div>
    </section>
  );
}
