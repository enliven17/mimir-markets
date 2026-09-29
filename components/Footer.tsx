import { Link } from "@/i18n/navigation";
import { MIMIR_PROGRAM_ID } from "@/lib/solana/config";
import { NAV_MORE_GROUPS, NAV_PRIMARY } from "./nav-items";

const REPO_URL = "https://github.com/enliven17/mimir-solana";
const OPENAPI_URL = `${REPO_URL}/blob/main/docs/openapi-agent-v1.yaml`;
const MAGICBLOCK_URL = "https://www.magicblock.xyz";

const PROGRAM_ID = MIMIR_PROGRAM_ID.toBase58();
const PROGRAM_SHORT = `${PROGRAM_ID.slice(0, 4)}…${PROGRAM_ID.slice(-4)}`;
const PROGRAM_EXPLORER_URL = `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;

const PRODUCT_LINKS = [
  ...NAV_PRIMARY,
  ...NAV_MORE_GROUPS.filter((g) => g.label !== "Build").flatMap((g) => g.items),
];

type FooterLink = { label: string } & ({ href: string; external?: false } | { url: string; external: true });

const DEVELOPER_LINKS: readonly FooterLink[] = [
  { label: "Docs", href: "/docs" },
  { label: "Connect agent", href: "/agents/new" },
  { label: "API / OpenAPI", url: OPENAPI_URL, external: true },
  { label: "GitHub", url: REPO_URL, external: true },
];

const linkClass =
  "font-mono text-[13px] text-pv-muted transition-colors hover:text-pv-emerald focus-ring";

function ColumnTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-text">
      {children}
    </h2>
  );
}

function ExternalLink({ url, children }: { url: string; children: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
      <span aria-hidden className="ml-1 text-pv-muted/60">↗</span>
    </a>
  );
}

// Blueprint footer: framed on the same column as the page rails.
export default function Footer() {
  return (
    <footer className="relative">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="border-x border-t border-pv-border/25 bg-pv-bg">
          <div className="grid gap-px bg-pv-border/15 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
            {/* Brand */}
            <div className="bg-pv-bg px-6 py-10 sm:col-span-2 sm:px-8 lg:col-span-1 lg:py-12">
              <Link href="/" className="inline-block focus-ring">
                <span className="font-display text-2xl font-bold tracking-tight text-pv-text">
                  Mimir<span className="text-pv-emerald">.</span>
                </span>
              </Link>
              <p className="mt-4 max-w-xs font-mono text-[13px] leading-relaxed text-pv-muted">
                AI-settled claim markets on Solana. Stake USDC on a claim; an AI
                oracle and a 20-persona council settle it on-chain against the
                evidence.
              </p>
            </div>

            {/* Product */}
            <nav aria-label="Product" className="bg-pv-bg px-6 py-10 sm:px-8 lg:py-12">
              <ColumnTitle>Product</ColumnTitle>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-1">
                {PRODUCT_LINKS.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className={linkClass}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Developers */}
            <nav aria-label="Developers" className="bg-pv-bg px-6 py-10 sm:px-8 lg:py-12">
              <ColumnTitle>Developers</ColumnTitle>
              <ul className="space-y-3">
                {DEVELOPER_LINKS.map((item) => (
                  <li key={item.label}>
                    {item.external ? (
                      <ExternalLink url={item.url}>{item.label}</ExternalLink>
                    ) : (
                      <Link href={item.href} className={linkClass}>
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>

            {/* Network */}
            <div className="bg-pv-bg px-6 py-10 sm:col-span-2 sm:px-8 lg:col-span-1 lg:py-12">
              <ColumnTitle>Network</ColumnTitle>
              <dl className="space-y-3 font-mono text-[13px]">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-pv-muted">Cluster</dt>
                  <dd className="flex items-center gap-2 text-pv-text">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-pv-gold" />
                    Solana devnet
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-pv-muted">Program</dt>
                  <dd>
                    <a
                      href={PROGRAM_EXPLORER_URL}
                      target="_blank"
                      rel="noreferrer"
                      title={PROGRAM_ID}
                      aria-label={`Program ${PROGRAM_ID} on Solana Explorer`}
                      className="text-pv-text transition-colors hover:text-pv-emerald focus-ring"
                    >
                      {PROGRAM_SHORT}
                      <span aria-hidden className="ml-1 text-pv-muted/60">↗</span>
                    </a>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-pv-muted">Rollup</dt>
                  <dd>
                    <a
                      href={MAGICBLOCK_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pv-text transition-colors hover:text-pv-emerald focus-ring"
                    >
                      MagicBlock ER
                      <span aria-hidden className="ml-1 text-pv-muted/60">↗</span>
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-pv-border/25 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span className="font-mono text-[11px] tracking-wide text-pv-muted">
              © {new Date().getFullYear()} Mimir Markets · AGPL-3.0
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
