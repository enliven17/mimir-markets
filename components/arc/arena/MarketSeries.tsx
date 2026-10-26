"use client";
import { Link } from "@/i18n/navigation";
import { MARKET_SERIES, nextSeriesDeadline, seriesForMarket } from "@/lib/market-series";
import FollowButton from "@/components/discovery/FollowButton";
type Market = { kind: "vs" | "pool"; marketId: number; question: string; resolutionUrl: string; deadline: number; labelA: string; labelB: string; category: string; status: string };
export default function MarketSeries({ markets }: { markets: readonly Market[] }) {
  const deadline = nextSeriesDeadline(Date.now());
  return <section className="grid gap-3" aria-label="Daily market series"><div className="grid gap-1"><h2 className="m-0 font-display text-[1.5rem] text-cream">Daily checkpoints</h2><p className="m-0 text-[13px] text-muted">Two recurring templates. Same source and rule, a new date. Join an existing pool before opening another.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">{MARKET_SERIES.map((s) => {
      const existing = markets.find((m) => m.kind === "pool" && m.deadline === deadline && (m.status === "open" || m.status === "active") && seriesForMarket(m) === s.id);
      return <div key={s.id} className="grid gap-3 rounded-2xl bg-cream/[0.04] p-4"><span className="text-[15px] text-cream">{s.name}</span><span className="text-[12px] text-muted">Next checkpoint {new Date(deadline * 1000).toLocaleString("en-US", { timeZone: "UTC" })} UTC</span><div className="flex flex-wrap items-center gap-3"><Link className="text-[13px] text-coral" href={existing ? `/arena/arc/pool/${existing.marketId}` : `/arena/create?series=${s.id}`}>{existing ? "Join the current pool →" : "Open next checkpoint →"}</Link><FollowButton target={`series:${s.id}`} label="Follow series" /></div></div>;
    })}</div>
  </section>;
}
