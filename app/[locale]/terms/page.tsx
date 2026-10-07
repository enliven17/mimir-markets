import { SURFACE } from "@/components/arena/surface";
import { TERMS, TERMS_UPDATED } from "@/lib/terms";
import { pageMeta } from "@/lib/seo";

/* /terms: what a visitor accepts by using Mimir (lib/terms.ts is the source; the consent card shows the short form). */

export const metadata = pageMeta({
  path: "/terms",
  title: "Terms of use · Mimir Markets",
  description: "The terms you accept by using Mimir: your own choice, your own risk, your local law, no advice.",
});

export default function TermsPage() {
  return (
    <article className="mx-auto grid max-w-[760px] gap-6">
      <header className="grid gap-3">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Terms of use</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">Using Mimir is your choice and your risk.</h1>
        <p className="m-0 text-[14px] text-muted">Last updated {TERMS_UPDATED}.</p>
      </header>
      {TERMS.map((s, i) => (
        <section key={s.title} className={`${SURFACE} grid gap-3 p-5 sm:p-6`}>
          <h2 className="m-0 text-[16px] text-cream">
            <span className="mr-2 font-mono text-[12px] text-dim">{String(i + 1).padStart(2, "0")}</span>
            {s.title}
          </h2>
          <ul className="m-0 grid gap-2.5 pl-5 text-[14px] leading-relaxed text-muted marker:text-coral">
            {s.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
