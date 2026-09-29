/**
 * Mimir wordmark in Terminal Grotesque with a gradient-clipped fill:
 * "Mi" deep→red, "mir"
 * animated heat gradient (static under reduced motion).
 */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark !gap-0 ${className}`} role="img" aria-label="Mimir">
      <span aria-hidden className="wordmark-fill">
        Mi
      </span>
      <span aria-hidden className="wordmark-heat">
        mir
      </span>
    </span>
  );
}
