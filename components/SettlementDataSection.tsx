"use client";

/**
 * Landing section: what price settlement actually reads, and who provides it
 * (lib/server/price-sources.ts). Doubles as the CoinMarketCap attribution for
 * the data the oracle uses from its API.
 */
import { BlueprintHeading } from "@/components/BlueprintGrid";
import CoinMarketCapMark from "@/components/brand/CoinMarketCapMark";

const SOURCES: Array<{ name: string; href: string; role: string; body: string; mark?: boolean }> = [
  {
    name: "Flash Trade",
    href: "https://flash.trade",
    role: "Resolution feed",
    body: "The oracle price most crypto claims name as their resolution source, read from the public Flash Trade API.",
  },
  {
    name: "CoinGecko",
    href: "https://www.coingecko.com",
    role: "Independent reading",
    body: "Structured price data read straight from the API, including the historical price at the deadline.",
  },
  {
    name: "CoinMarketCap",
    href: "https://coinmarketcap.com",
    role: "Independent reading",
    body: "Price data provided by the CoinMarketCap API: separate exchange coverage and weighting, so the readings do not share a mistake.",
    mark: true,
  },
  {
    name: "Chainlink",
    href: "https://data.chain.link",
    role: "Independent reading",
    body: "On-chain reference feeds for the majors, read at the last round at or before the deadline.",
  },
];

export default function SettlementDataSection() {
  return (
    <section>
      <BlueprintHeading subtitle="A market settled from one page has one point of failure. For price claims the oracle reads independent sources at the deadline: when they agree the verdict carries more confidence, and when they land on opposite sides of the threshold the claim refunds instead of picking a winner.">
        Settlement data
      </BlueprintHeading>
      <div className="bp-grid grid-cols-1 border-x border-pv-border/25 sm:grid-cols-2 lg:grid-cols-4">
        {SOURCES.map((s) => (
          <div key={s.name} className="bp-cell flex flex-col gap-2 p-6">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald">{s.role}</p>
            {s.mark ? (
              <CoinMarketCapMark height={20} className="font-display text-lg text-pv-text" />
            ) : (
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display text-lg font-bold text-pv-text transition-colors hover:text-pv-emerald"
              >
                {s.name}
              </a>
            )}
            <p className="text-[13px] leading-relaxed text-pv-muted">{s.body}</p>
          </div>
        ))}
      </div>
      <p className="border-x border-b border-pv-border/25 px-6 py-4 text-center font-mono text-[11px] text-pv-muted">
        Every reading and the resulting verdict go into the audit bundle whose hash is committed on chain, so the cross-check can be verified rather than taken on trust.
      </p>
    </section>
  );
}
