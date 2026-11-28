/**
 * Docs section: what price settlement actually reads, and who provides it
 * (lib/server/price-sources.ts). Doubles as the CoinMarketCap attribution for
 * the data the oracle uses from its API.
 */
import CoinMarketCapMark from "@/components/brand/CoinMarketCapMark";

const SOURCES: Array<{ name: string; href: string; role: string; body: string; mark?: boolean }> = [
  {
    name: "CoinGecko",
    href: "https://www.coingecko.com",
    role: "Independent reading",
    body: "Structured price data read straight from the API, including the historical price nearest the deadline.",
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
    body: "On-chain reference feeds for the listed majors, read at the last round at or before the deadline.",
  },
];

/** Body of the docs "Price data" section: one line, the sources, the audit note. */
export default function SettlementData() {
  return (
    <>
      <p className="m-0">
        For price claims the oracle reads the price at the deadline from independent sources. Each reading keeps its own
        timestamp; one too far from the deadline is dropped. With fewer than two readings (one for an asset only one
        source can price historically) the claim waits up to 6 hours, then refunds. Sources on opposite sides of the
        threshold refund the claim; a model contradicting agreeing sources refunds it too.
      </p>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {SOURCES.map((s) => (
          <li key={s.name} className="grid content-start gap-2 rounded-xl bg-cream/[0.04] p-5">
            <p className="m-0 text-[12px] uppercase tracking-[0.06em] text-muted">{s.role}</p>
            {s.mark ? (
              <CoinMarketCapMark height={20} className="font-display text-[1.2rem] text-cream" />
            ) : (
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="justify-self-start font-display text-[1.2rem] leading-tight text-cream transition-colors hover:text-coral"
              >
                {s.name}
              </a>
            )}
            <p className="m-0 text-[14px] leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13px] text-muted">
        Every reading (source, price, timestamp) goes into the collector step of the audit bundle, which is committed on
        chain under the Proof-of-Reasoning root, so the cross-check can be verified rather than taken on trust.
      </p>
    </>
  );
}
