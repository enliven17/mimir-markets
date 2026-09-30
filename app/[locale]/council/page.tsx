import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import CouncilRoster, { type RosterPersona } from "@/components/council/CouncilRoster";
import EmptyState from "@/components/ui/EmptyState";
import { StatusPill } from "@/components/ui/StatusPill";
import { Strip, StripCell } from "@/components/ui/Strip";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { councilStats, type OracleStats, type PersonaStats } from "@/lib/server/council-stats";
import { formatUsdcUnitsBare } from "@/lib/money";

/**
 * /council: the jury. One line of copy, the four totals in one strip, the
 * oracle first, then the two tracks behind a segmented control.
 *
 * Rendered per request, never prerendered: building it statically would put a
 * chain scan on the critical path of every deploy. The data layer caches the
 * scan for 30s (lib/server/council-stats.ts).
 */
export const dynamic = "force-dynamic";

const short = (a: string) => (a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "-");

function toRoster(s: PersonaStats): RosterPersona {
  const p = s.persona;
  return {
    slug: p.slug,
    displayName: p.displayName,
    bio: p.bio,
    archetype: p.archetype,
    track: p.track,
    address: p.address,
    categoryFilter: p.categoryFilter,
    bankroll: s.bankroll.toString(),
    atRisk: s.atRisk.toString(),
    stakes: s.stakes,
    won: s.won,
    lost: s.lost,
    recentBets: s.recentBets.map((b) => ({ claimId: b.claimId, stake: b.stake.toString() })),
  };
}

async function OracleCard({ oracle }: { oracle: OracleStats }) {
  const t = await getTranslations("council");
  return (
    <article className={`${SURFACE} grid gap-4 p-5 shadow-[inset_0_0_0_1px_rgb(255_81_72/.28)] sm:flex sm:items-center sm:gap-6 sm:p-6`}>
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <PeepAvatar seed="oracle-mimir" size={48} shape="square" tone="accent" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 font-display text-[1.5rem] leading-none text-cream">{t("oracle.name")}</h2>
            <StatusPill tone="live" className="!min-h-[24px] !text-[12px]">
              {t("oracle.role")}
            </StatusPill>
          </div>
          <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-muted">{t("oracle.blurb")}</p>
        </div>
      </div>
      <div className="flex flex-none items-baseline gap-5 text-[13px]">
        {/* The explorer link sits beside the list, not inside it: a dl holds only dt/dd groups. */}
        <dl className="m-0 contents">
        <div>
          <dt className="text-muted">{t("stakes")}</dt>
          <dd className="m-0 font-mono text-[16px] tabular-nums text-cream">{oracle.stakes}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("oracle.staked")}</dt>
          <dd className="m-0 font-mono text-[16px] tabular-nums text-cream">{formatUsdcUnitsBare(oracle.staked)}</dd>
        </div>
        </dl>
        {oracle.address ? (
          <a
            href={`https://explorer.solana.com/address/${oracle.address}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto self-center font-mono text-[12px] text-muted hover:text-coral sm:ml-0"
          >
            {short(oracle.address)} ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export default async function CouncilPage() {
  const t = await getTranslations("council");
  const stats = await councilStats().catch(() => null);
  const personas = stats?.personas ?? [];
  const sum = (f: (s: PersonaStats) => bigint) => personas.reduce((a, s) => a + f(s), 0n);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="grid gap-2">
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
        <p className="m-0 max-w-[62ch] text-[15px] leading-relaxed text-muted">{t("lead")}</p>
      </header>

      {!stats ? (
        <EmptyState>{t("unavailable")}</EmptyState>
      ) : (
        <>
          <Strip label={t("stripLabel")} className="overflow-hidden rounded-2xl">
            <StripCell label={t("statPersonas")} value={personas.length} />
            <StripCell label={t("statStakes")} value={personas.reduce((a, s) => a + s.stakes, 0)} />
            <StripCell label={t("statAtRisk")} value={formatUsdcUnitsBare(sum((s) => s.atRisk))} />
            <StripCell label={t("statBankroll")} value={formatUsdcUnitsBare(sum((s) => s.bankroll))} />
          </Strip>

          <OracleCard oracle={stats.oracle} />

          <CouncilRoster personas={personas.map(toRoster)} />

          <p className="m-0 text-center text-[12px] text-dim">{t(stats.source === "index" ? "sourceIndex" : "sourceChain")}</p>
        </>
      )}

      <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px]">
        <Link href="/agents" className="text-muted transition-colors hover:text-cream">
          {t("navAgents")} →
        </Link>
        <Link href="/calibration" className="text-muted transition-colors hover:text-cream">
          {t("navCalibration")} →
        </Link>
      </nav>
    </div>
  );
}
