/** The "opens elsewhere" arrow after a link: drawn, not the ↗ glyph (which renders as an emoji on some platforms). */
export function ExternalMark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 10 10" className={`inline-block h-[0.7em] w-[0.7em] align-baseline ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M2.5 7.5 7.5 2.5M3.5 2.5h4v4" />
    </svg>
  );
}
