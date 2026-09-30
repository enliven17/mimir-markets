/**
 * Docs section: what price settlement actually reads, and who provides it
 * (lib/server/price-sources.ts). Doubles as the CoinMarketCap attribution for
 * the data the oracle uses from its API.
 */
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

/** Body of the docs "Settlement data" section: one line, the four sources, the audit note. */
export default function SettlementData() {
  return (
    <>
      <p className="m-0">
        For price claims the oracle reads independent sources at the deadline. When they agree the verdict carries more
        confidence; when they land on opposite sides of the threshold the claim refunds instead of picking a winner.
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
        Every reading and the resulting verdict go into the audit bundle whose hash is committed on chain, so the
        cross-check can be verified rather than taken on trust.
      </p>
    </>
  );
}
