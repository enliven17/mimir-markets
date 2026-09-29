import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BlueprintHeading, BlueprintSection, BlueprintStat } from "@/components/BlueprintGrid";
import TokenYourTier from "@/components/token/TokenYourTier";
import { fetchDexReadings } from "@/lib/server/dex-prices";
import { mainnetMintSupply } from "@/lib/server/mainnet";
import { cachedFor } from "@/lib/server/ttl-cache";
import { ansemMint, mimirMint, mimirSymbol, mimirTokenUrl } from "@/lib/token-config";
import {
  TIER_RATE_MULTIPLIER,
  agentRegisterGateFromEnv,
  basketMinTierFromEnv,
  gateEnabled,
  tierThresholdsFromEnv,
} from "@/lib/token-tiers";

export const dynamic = "force-dynamic";

/** A price is the median of what the DEX readers return right now; null when none answer. */
const livePrice = cachedFor(async (mint: string): Promise<number | null> => {
  const readings = await fetchDexReadings(mint);
  if (readings.length === 0) return null;
  const sorted = readings.map((r) => r.priceUsd).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}, 60_000);

const usd = (n: number) =>
  n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toPrecision(3)}`;
const compact = (n: number) => n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
const short = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

function Perk({ title, body, on, where, labels }: { title: string; body: string; on: boolean; where: string; labels: { on: string; off: string; where: string } }) {
  return (
    <div className="bp-cell space-y-2 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-pv-text">{title}</h3>
        <span
          className={`border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${
            on ? "border-pv-emerald/40 text-pv-emerald" : "border-pv-border/25 text-pv-muted"
          }`}
        >
          {on ? labels.on : labels.off}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-pv-text/85">{body}</p>
      <p className="font-mono text-[11px] text-pv-muted">
        {labels.where}: <code>{where}</code>
      </p>
    </div>
  );
}

export default async function TokenPage() {
  const t = await getTranslations("token");
  const symbol = mimirSymbol();
  const mint = mimirMint();
  const launched = mint !== null;
  const thresholds = tierThresholdsFromEnv();
  const registerGate = agentRegisterGateFromEnv(launched);
  const basketTier = basketMinTierFromEnv(launched);

  const [supply, price, ansemPrice] = await Promise.all([
    mint ? mainnetMintSupply(mint).catch(() => null) : Promise.resolve(null),
    mint ? livePrice(mint).catch(() => null) : Promise.resolve(null),
    livePrice(ansemMint()).catch(() => null),
  ]);
  const labels = { on: t("on"), off: t("off"), where: t("where") };
  const fmtN = (n: number) => n.toLocaleString("en-US");

  return (
    <div className="pb-12">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow", { symbol })} subtitle={t("subtitle")}>
        {t("title")}
      </BlueprintHeading>

      {launched ? (
        <div data-bp-rails className="bp-grid border-x border-pv-border/25 sm:grid-cols-4">
          <BlueprintStat value={price !== null ? usd(price) : t("unavailable")} label={t("price")} />
          <BlueprintStat value={supply ? compact(supply.supply) : t("unavailable")} label={t("supply")} tone="text" />
          <BlueprintStat value={supply && price !== null ? usd(supply.supply * price) : t("unavailable")} label={t("fdv")} tone="text" />
          <div className="bp-cell flex flex-col items-center justify-center gap-2 p-5 text-center sm:p-6">
            <a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer" className="font-mono text-sm text-pv-emerald hover:underline">
              {short(mint)}
            </a>
            <a href={mimirTokenUrl()} target="_blank" rel="noreferrer" className="font-mono text-[11px] uppercase tracking-[0.14em] text-pv-muted hover:text-pv-text">
              {t("tradeCta")} →
            </a>
          </div>
        </div>
      ) : (
        <div data-bp-rails className="border-x border-pv-border/25 px-4 py-8 text-center sm:px-6">
          <p className="font-display text-xl font-bold uppercase tracking-tight text-pv-emerald">{t("launchingTitle")}</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-pv-muted">{t("launchingBody")}</p>
          <a
            href={mimirTokenUrl()}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block border border-pv-emerald bg-pv-emerald px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-pv-bg hover:brightness-110 focus-ring"
          >
            {t("launchingCta")}
          </a>
        </div>
      )}

      <BlueprintSection title={t("yourTier")}>
        <TokenYourTier />
      </BlueprintSection>

      <BlueprintSection title={t("perksTitle")} subtitle={t("perksSubtitle")} bodyClassName="bp-grid sm:grid-cols-2">
        <Perk
          title={t("perk.council.title")}
          body={t("perk.council.body", { x2: TIER_RATE_MULTIPLIER.holder, x4: TIER_RATE_MULTIPLIER.backer, x8: TIER_RATE_MULTIPLIER["oracle-circle"] })}
          on
          where="lib/server/holder.ts rateIdentity → /api/council/reasoning, /api/council/preflight"
          labels={labels}
        />
        <Perk
          title={t("perk.register.title")}
          body={t("perk.register.body", {
            mimir: registerGate.minMimir > 0 ? fmtN(registerGate.minMimir) : t("perk.register.unset"),
            ansem: registerGate.minAnsem > 0 ? fmtN(registerGate.minAnsem) : t("perk.register.unset"),
            symbol,
          })}
          on={gateEnabled(registerGate)}
          where="/api/agents/v1/register (enforceRegisterGate)"
          labels={labels}
        />
        <Perk
          title={t("perk.baskets.title")}
          body={t("perk.baskets.body", { tier: t(`tier.${basketTier === "none" ? "holder" : basketTier}`) })}
          on={basketTier !== "none"}
          where="POST /api/baskets"
          labels={labels}
        />
        <Perk
          title={t("perk.prices.title")}
          body={t("perk.prices.body", { symbol })}
          on
          where="lib/server/dex-prices.ts → price-sources.ts → oracle resolver spec"
          labels={labels}
        />
      </BlueprintSection>

      <BlueprintSection title={t("tiersTitle")} subtitle={t("tiersSubtitle")} bodyClassName="px-4 py-6 sm:px-6">
        <div className="overflow-x-auto border border-pv-border/25">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-pv-surface font-mono text-[11px] uppercase tracking-[0.14em] text-pv-muted">
              <tr>
                <th className="px-4 py-3">{t("tierCol")}</th>
                <th className="px-4 py-3">{t("needs")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-border/25">
              <tr>
                <td className="px-4 py-3 text-pv-text">{t("tier.holder")}</td>
                <td className="px-4 py-3 font-mono text-pv-text/85">
                  ≥ {fmtN(thresholds.holder)} {symbol}
                  {thresholds.ansemHolderMin > 0 ? ` ${t("orAnsem", { n: fmtN(thresholds.ansemHolderMin) })}` : ""}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-pv-text">{t("tier.backer")}</td>
                <td className="px-4 py-3 font-mono text-pv-text/85">≥ {fmtN(thresholds.backer)} {symbol}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-pv-text">{t("tier.oracle-circle")}</td>
                <td className="px-4 py-3 font-mono text-pv-text/85">≥ {fmtN(thresholds.oracleCircle)} {symbol}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </BlueprintSection>

      <BlueprintSection title={t("ansemTitle")} bodyClassName="px-4 py-6 sm:px-6">
        <p className="text-sm leading-relaxed text-pv-text/85">{t("ansemBody", { n: fmtN(thresholds.ansemHolderMin) })}</p>
        <p className="mt-3 font-mono text-xs text-pv-muted">
          <a href={`https://solscan.io/token/${ansemMint()}`} target="_blank" rel="noreferrer" className="text-pv-emerald hover:underline">
            {short(ansemMint())}
          </a>
          {ansemPrice !== null ? ` · ${t("price")}: ${usd(ansemPrice)}` : ""}
        </p>
      </BlueprintSection>

      <BlueprintSection title={t("roadmapTitle")} bodyClassName="px-4 py-6 sm:px-6">
        <ul className="space-y-3 text-sm leading-relaxed text-pv-text/85">
          <li>{t("roadmap.now")}</li>
          <li>{t("roadmap.next")}</li>
          <li>{t("roadmap.fees")}</li>
          <li className="text-pv-muted">{t("roadmap.honest")}</li>
        </ul>
      </BlueprintSection>

      <p className="mt-6 text-center text-sm">
        <Link href="/arena" className="text-pv-muted hover:text-pv-text">{t("back")}</Link>
      </p>
    </div>
  );
}
