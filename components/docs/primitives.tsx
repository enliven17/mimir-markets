/**
 * Small building blocks shared by the /docs sections: a key/value list, a card, a plain table, a code block and a
 * callout. Server components only; styling follows the rest of the docs page.
 */
import type { ReactNode } from "react";

export const LINK = "text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral";
export const CODE = "rounded-sm bg-cream/[0.07] px-1.5 py-0.5 font-mono text-[13px] text-cream";

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return <code className={CODE}>{children}</code>;
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="m-0 grid overflow-hidden rounded-xl bg-cream/[0.03] text-[14px]">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 text-cream/90">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-cream/[0.04] p-5">
      <h3 className="m-0 mb-2 font-display text-[1.15rem] leading-tight text-cream">{title}</h3>
      <div className="text-[14px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** A plain table that scrolls sideways inside its own box on narrow screens. */
export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-cream/[0.03]">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13.5px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="border-b border-line px-4 py-2.5 font-mono text-[11.5px] font-normal uppercase tracking-[0.12em] text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className={`border-b border-line px-4 py-2.5 leading-relaxed ${j === 0 ? "text-cream" : "text-cream/80"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeBlock({ label, children }: { label?: string; children: string }) {
  return (
    <figure className="m-0 grid gap-1.5">
      {label ? <figcaption className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-muted">{label}</figcaption> : null}
      <pre className="m-0 overflow-x-auto rounded-xl bg-cream/[0.04] p-4 font-mono text-[13px] leading-relaxed text-cream/90">{children}</pre>
    </figure>
  );
}

/** A boxed notice. `tone="risk"` is the prominent risk warning. */
export function Callout({ title, tone = "note", children }: { title: string; tone?: "note" | "risk"; children: ReactNode }) {
  const risk = tone === "risk";
  return (
    <aside
      role={risk ? "note" : undefined}
      aria-label={title}
      className={`grid gap-2 rounded-xl p-4 text-[14px] leading-relaxed sm:p-5 ${
        risk ? "bg-coral/[0.08] shadow-[inset_0_0_0_1px_rgb(255_81_72/.55)]" : "bg-cream/[0.04]"
      }`}
    >
      <p className={`m-0 font-mono text-[12px] uppercase tracking-[0.16em] ${risk ? "text-coral" : "text-muted"}`}>{title}</p>
      <div className="grid gap-2 text-cream/85">{children}</div>
    </aside>
  );
}
