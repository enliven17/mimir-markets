import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BlueprintHeading, BlueprintSection, BlueprintStat } from "@/components/BlueprintGrid";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { councilStats, type PersonaStats } from "@/lib/server/council-stats";
import { formatUsdcUnitsBare } from "@/lib/money";
import type { CouncilTrack } from "@/agents/council/personas";

/**
 * /council — both juries with their stakes, record and bankroll.
 *
 * Rendered per request, never prerendered: building it statically would put a
 * chain scan on the critical path of every deploy. The data layer caches the
 * scan for 30s (lib/server/council-stats.ts).
 */
export const dynamic = "force-dynamic";

const TRACKS: CouncilTrack[] = ["classic", "philosopher"];

function shortAddr(a: string): string {
  return a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "—";
}

async function PersonaCard({ stats }: { stats: PersonaStats }) {
  const t = await getTranslations("council");
  const { persona } = stats;
  const active = stats.stakes > 0;
  return (
    <article className="flex h-full flex-col gap-4 bg-pv-bg p-5 transition-colors hover:bg-pv-surface">
      <header className="flex items-start gap-3">
        <PeepAvatar seed={`council-${persona.slug}`} size={56} shape="square" tone={active ? "accent" : "neutral"} alt="" />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
            <span aria-hidden>{persona.emoji} </span>
            {persona.displayName}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-pv-muted">
            {t(`archetype.${persona.archetype}` as never)}
          </p>
        </div>
      </header>

      <p className="text-[12px] leading-relaxed text-pv-text/75">{persona.bio}</p>

      {persona.categoryFilter?.length ? (
        <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
          {persona.categoryFilter.map((c) => (
            <span key={c} className="border border-pv-border/25 px-1.5 py-0.5">{c}</span>
          ))}
        </div>
      ) : null}

      <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-pv-border/25 pt-3 text-center">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">{t("bankroll")}</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">{formatUsdcUnitsBare(stats.bankroll)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">{t("stakes")}</dt>
          <dd className={`mt-0.5 font-display text-sm font-bold tabular-nums ${active ? "text-pv-emerald" : "text-pv-text"}`}>{stats.stakes}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">{t("atRisk")}</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">{formatUsdcUnitsBare(stats.atRisk)}</dd>
        </div>
      </dl>
      {stats.won + stats.lost > 0 ? (
        <p className="-mt-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
          {t("record", { won: stats.won, lost: stats.lost })}
        </p>
      ) : null}

      {stats.recentBets.length > 0 ? (
        <ul className="space-y-1.5 border-t border-pv-border/25 pt-3">
          {stats.recentBets.map((b) => (
            <li key={b.claimId} className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
              <Link href={`/arena/${b.claimId}`} className="text-pv-emerald hover:underline">
                {t("claim", { id: b.claimId })}
              </Link>
              <span className="tabular-nums text-pv-text/85">{formatUsdcUnitsBare(b.stake)} USDC</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-pv-border/25 pt-3 text-center font-mono text-[10px] italic text-pv-muted">
          {stats.bankroll === 0n && persona.address ? t("unfunded") : t("noBets")}
        </p>
      )}

      {persona.address ? (
        <a
          href={`https://explorer.solana.com/address/${persona.address}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="text-center font-mono text-[10px] text-pv-muted hover:text-pv-emerald"
        >
          {shortAddr(persona.address)} ↗
        </a>
      ) : null}
    </article>
  );
}

export default async function CouncilPage() {
  const t = await getTranslations("council");
  const stats = await councilStats().catch(() => null);
  const personas = stats?.personas ?? [];
  const sum = (f: (s: PersonaStats) => bigint) => personas.reduce((a, s) => a + f(s), 0n);

  return (
    <div className="pb-12">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("subtitle")}>
        {t("title")}
      </BlueprintHeading>

      {!stats ? (
        <p className="border-b border-pv-border/25 p-8 text-center text-sm text-pv-muted">{t("unavailable")}</p>
      ) : (
        <>
          <div className="bp-cells grid-cols-2 border-b border-pv-border/25 lg:grid-cols-4">
            <BlueprintStat value={personas.length} label={t("statPersonas")} tone="text" />
            <BlueprintStat value={personas.reduce((a, s) => a + s.stakes, 0)} label={t("statStakes")} />
            <BlueprintStat value={formatUsdcUnitsBare(sum((s) => s.atRisk))} label={t("statAtRisk")} tone="text" />
            <BlueprintStat value={formatUsdcUnitsBare(sum((s) => s.bankroll))} label={t("statBankroll")} tone="gold" />
          </div>

          {TRACKS.map((track) => {
            const members = personas.filter((s) => s.persona.track === track);
            if (members.length === 0) return null;
            return (
              <BlueprintSection
                key={track}
                id={`track-${track}`}
                eyebrow={t("trackCount", { count: members.length })}
                title={t(`tracks.${track}.title`)}
                subtitle={t(`tracks.${track}.blurb`)}
                bodyClassName="bp-cells grid-cols-1 border-b border-pv-border/25 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              >
                {members.map((s) => (
                  <PersonaCard key={s.persona.slug} stats={s} />
                ))}
              </BlueprintSection>
            );
          })}

          <p className="px-4 pt-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
            {t(stats.source === "index" ? "sourceIndex" : "sourceChain")}
          </p>
        </>
      )}

      <nav className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <Link href="/agents" className="text-pv-muted transition-colors hover:text-pv-text">{t("navAgents")}</Link>
        <Link href="/calibration" className="text-pv-muted transition-colors hover:text-pv-text">{t("navCalibration")}</Link>
        <Link href="/arena" className="text-pv-muted transition-colors hover:text-pv-text">{t("navArena")}</Link>
      </nav>
    </div>
  );
}
