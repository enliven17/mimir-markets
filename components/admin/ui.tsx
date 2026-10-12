// The admin panel's building blocks (AdminPanel.tsx, InvitesCard.tsx).
import type { ReactNode } from "react";

import { SURFACE } from "@/components/arena/surface";

export function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className={`${SURFACE} grid min-w-0 content-start gap-3 p-4 sm:p-5`}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] text-cream">{title}</h2>
        {note ? <span className="text-[12px] text-dim">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * A table that always fits its card, never scrolling sideways: long cells wrap. Below md each row becomes a small
 * labelled block instead, so a nine-column table still reads on a phone.
 */
export function Table({ head, rows, empty = "None." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="m-0 text-[13px] text-muted">{empty}</p>;
  return (
    <>
      <table className="hidden w-full border-collapse text-left text-[13px] md:table">
        <thead>
          <tr>{head.map((h, i) => <th key={i} className="px-1.5 pb-2 font-normal text-muted">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5 align-top">
              {r.map((c, j) => <td key={j} className="px-1.5 py-1.5 text-cream [overflow-wrap:anywhere]">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="m-0 grid list-none gap-2 p-0 text-[13px] md:hidden">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-1 rounded-xl bg-panel px-3 py-2.5">
            {r.map((c, j) => (
              <div key={j} className="flex min-w-0 justify-between gap-3">
                {head[j] ? <span className="shrink-0 text-muted">{head[j]}</span> : null}
                <span className={`min-w-0 text-cream [overflow-wrap:anywhere] ${head[j] ? "text-right" : "font-medium"}`}>{c}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
