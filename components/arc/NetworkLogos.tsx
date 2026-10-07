/**
 * The two networks Mimir runs on, as their official wordmarks (public/networks,
 * from arc.network and solana.com's brand kit): Arc, where markets settle, and
 * Solana, where your wallet and $MIMIR live. White marks for the dark theme.
 */
export function NetworkLogos({ className = "h-6" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-4 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs, no optimisation to gain */}
      <img src="/networks/arc.svg" alt="Arc" className="h-full w-auto" />
      <span aria-hidden className="h-[60%] w-px bg-line" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/networks/solana.svg" alt="Solana" className="h-[62%] w-auto" />
    </span>
  );
}
