import { Link } from "@/i18n/navigation";
import { NAV_ITEMS } from "./nav-items";

// Blueprint footer: framed on the same column as the page rails.
export default function Footer() {
  return (
    <footer className="relative">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="border-x border-t border-pv-border/25 bg-pv-bg">
          <div className="flex flex-col gap-6 px-6 py-7 sm:px-10 sm:py-8 md:flex-row md:items-center md:justify-between">
            <div className="max-w-sm">
              <span className="font-display text-2xl font-bold tracking-tight text-pv-text">
                Mimir<span className="text-pv-emerald">.</span>
              </span>
              <p className="mt-2 font-mono text-[13px] leading-relaxed text-pv-muted">
                AI-settled claim markets on Solana. Stake USDC on your claim —
                Mimir settles it on-chain against the evidence.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="font-mono text-[12px] uppercase tracking-[0.14em] text-pv-muted transition-colors hover:text-pv-emerald focus-ring"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex flex-col items-center justify-between gap-2 border-t border-pv-border/25 px-6 py-4 sm:flex-row sm:px-10">
            <span className="font-mono text-[11px] tracking-wide text-pv-muted">
              © {new Date().getFullYear()} Mimir Markets
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-pv-muted">
              Settled on Solana devnet
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
