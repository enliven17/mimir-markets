/** Shown while the council's stakes and bankrolls are read on a cold cache. */
export default function CouncilLoading() {
  return (
    <section className="flex min-h-[60vh] items-center justify-center" aria-busy="true" aria-live="polite">
      <p className="animate-pulse font-mono text-xs uppercase tracking-[0.3em] text-pv-muted">
        Reading the council&apos;s bets from chain…
      </p>
    </section>
  );
}
