import { getTranslations } from "next-intl/server";
import { SURFACE } from "@/components/arena/surface";
import Disclosure from "@/components/ui/Disclosure";
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
  tierAtLeast,
  tierThresholdsFromEnv,
  type TokenTier,
} from "@/lib/token-tiers";

/**
 * /token: the mainnet price as the hero with supply and FDV in one line, the
 * connected wallet's tier, the three tiers as one row of cards with their
 * perks, then how each perk is enforced, $ANSEM and the roadmap behind
 * disclosures. Every number is a live mainnet read; nothing is made up.
 */
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
const fmtN = (n: number) => n.toLocaleString("en-US");

const TIERS: Exclude<TokenTier, "none">[] = ["holder", "backer", "oracle-circle"];
const LINK = "text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral";

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

  const need: Record<(typeof TIERS)[number], number> = {
    holder: thresholds.holder,
    backer: thresholds.backer,
    "oracle-circle": thresholds.oracleCircle,
  };

  const perks = [
    {
      key: "council",
      body: t("perk.council.body", { x2: TIER_RATE_MULTIPLIER.holder, x4: TIER_RATE_MULTIPLIER.backer, x8: TIER_RATE_MULTIPLIER["oracle-circle"] }),
      on: true,
      where: "lib/server/holder.ts rateIdentity → /api/council/reasoning, /api/council/preflight",
    },
    {
      key: "register",
      body: t("perk.register.body", {
        mimir: registerGate.minMimir > 0 ? fmtN(registerGate.minMimir) : t("perk.register.unset"),
        ansem: registerGate.minAnsem > 0 ? fmtN(registerGate.minAnsem) : t("perk.register.unset"),
        symbol,
      }),
      on: gateEnabled(registerGate),
      where: "/api/agents/v1/register (enforceRegisterGate)",
    },
    {
      key: "baskets",
      body: t("perk.baskets.body", { tier: t(`tier.${basketTier === "none" ? "holder" : basketTier}`) }),
      on: basketTier !== "none",
      where: "POST /api/baskets",
    },
    {
      key: "prices",
      body: t("perk.prices.body", { symbol }),
      on: true,
      where: "lib/server/dex-prices.ts → price-sources.ts → oracle resolver spec",
    },
  ] as const;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="grid gap-2">
        <p className="m-0 text-[13px] text-muted">{t("eyebrow", { symbol })}</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
        <p className="m-0 max-w-[56ch] text-[15px] leading-relaxed text-muted">{t("lead")}</p>
      </header>

      <section aria-label={t("price")} className={`${SURFACE} grid gap-5 p-5 sm:flex sm:items-end sm:justify-between sm:p-7`}>
        {launched ? (
          <div className="min-w-0">
            <p className="m-0 text-[13px] text-muted">{t("price")}</p>
            <p className="m-0 mt-2 font-mono text-[clamp(2.3rem,10vw,3.4rem)] leading-none tabular-nums text-cream">
              {price !== null ? usd(price) : <span className="text-dim">{t("unavailable")}</span>}
            </p>
            <p className="m-0 mt-2 flex flex-wrap gap-x-2 text-[13px] text-muted">
              <span>
                {t("supply")} <span className="font-mono text-cream">{supply ? compact(supply.supply) : "-"}</span>
              </span>
              <span aria-hidden>·</span>
              <span>
                {t("fdv")} <span className="font-mono text-cream">{supply && price !== null ? usd(supply.supply * price) : "-"}</span>
              </span>
              <span aria-hidden>·</span>
              <a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer" className={`font-mono ${LINK}`}>
                {short(mint)} ↗
              </a>
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="m-0 font-display text-[1.8rem] leading-none text-cream">{t("launchingTitle")}</p>
            <p className="m-0 mt-2 max-w-[48ch] text-[14px] leading-relaxed text-muted">{t("launchingBody")}</p>
          </div>
        )}
        <a
          href={mimirTokenUrl()}
          target="_blank"
          rel="noreferrer"
          className="btn-primary !min-h-[46px] !w-auto !flex-none !px-5 !py-2.5 !text-[15px]"
        >
          {launched ? t("tradeCta") : t("launchingCta")} ↗
        </a>
      </section>

      <section aria-labelledby="token-your-tier" className={`${SURFACE} grid gap-3 p-5 sm:p-6`}>
        <h2 id="token-your-tier" className="m-0 text-[13px] font-normal text-muted">
          {t("yourTier")}
        </h2>
        <TokenYourTier />
      </section>

      <section aria-labelledby="token-tiers" className="grid gap-3">
        <h2 id="token-tiers" className="m-0 font-display text-[1.6rem] leading-none text-cream">
          {t("tiersLabel")}
        </h2>
        <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
          {TIERS.map((tier, i) => (
            <li key={tier} className={`${SURFACE} card-in grid content-start gap-3 p-5 sm:row-span-3 sm:grid-rows-subgrid`} style={{ "--i": i } as React.CSSProperties}>
              <p className="m-0 font-display text-[1.35rem] leading-none text-cream">{t(`tier.${tier}`)}</p>
              <p className="m-0 font-mono text-[14px] text-cream">
                ≥ {t("needsAtLeast", { n: fmtN(need[tier]), symbol })}
                {tier === "holder" && thresholds.ansemHolderMin > 0 ? (
                  <span className="block text-[12px] text-muted">{t("orAnsem", { n: fmtN(thresholds.ansemHolderMin) })}</span>
                ) : null}
              </p>
              {/* Subgrid rows: the dividers line up although only Holder has a second threshold line. */}
              <ul className="m-0 grid list-none content-start gap-1.5 border-t border-line p-0 pt-3 text-[13px] text-muted">
                <li className="flex items-center gap-2">
                  <span aria-hidden className="h-1 w-1 rounded-[1px] bg-coral" />
                  {t("tierCouncil", { x: TIER_RATE_MULTIPLIER[tier] })}
                </li>
                {basketTier !== "none" && tierAtLeast(tier, basketTier) ? (
                  <li className="flex items-center gap-2">
                    <span aria-hidden className="h-1 w-1 rounded-[1px] bg-coral" />
                    {t("tierBaskets")}
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ol>
        <p className="m-0 text-[12px] text-dim">{t("cachedNote")}</p>
      </section>

      <div className="grid gap-3">
        <Disclosure summary={t("perksTitle")} meta={t("perksMeta", { on: perks.filter((p) => p.on).length, total: perks.length })}>
          <ul className="m-0 grid list-none gap-4 p-0">
            {perks.map((p) => (
              <li key={p.key} className="grid gap-1">
                <p className="m-0 flex items-center justify-between gap-3 text-[15px] text-cream">
                  {t(`perk.${p.key}.title`)}
                  <span className={`text-[12px] ${p.on ? "text-coral" : "text-dim"}`}>{p.on ? t("on") : t("off")}</span>
                </p>
                <p className="m-0 text-[13px] leading-relaxed text-muted">{p.body}</p>
                <p className="m-0 font-mono text-[12px] text-dim">
                  {t("where")}: <code className="break-words">{p.where}</code>
                </p>
              </li>
            ))}
          </ul>
        </Disclosure>

        <Disclosure summary={t("ansemTitle")} meta={ansemPrice !== null ? usd(ansemPrice) : undefined}>
          <p className="m-0 text-[14px] leading-relaxed text-muted">{t("ansemBody", { n: fmtN(thresholds.ansemHolderMin) })}</p>
          <a href={`https://solscan.io/token/${ansemMint()}`} target="_blank" rel="noreferrer" className={`mt-3 inline-block font-mono text-[13px] ${LINK}`}>
            {short(ansemMint())} ↗
          </a>
        </Disclosure>

        <Disclosure summary={t("roadmapTitle")}>
          <ul className="m-0 grid list-none gap-3 p-0 text-[14px] leading-relaxed text-muted">
            <li>{t("roadmap.now")}</li>
            <li>{t("roadmap.next")}</li>
            <li>{t("roadmap.fees")}</li>
            <li className="text-cream">{t("roadmap.honest")}</li>
          </ul>
        </Disclosure>
      </div>
    </div>
  );
}
