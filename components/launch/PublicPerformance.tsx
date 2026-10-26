"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { tradingPerformance } from "@/lib/launch/performance";
import { rhExplorer, solscan } from "@/lib/launch/council-view";

export default function PublicPerformance({ slug }: { slug: string }) {
  const data = useQuery(api.launch.performance, { slug });
  const [days, setDays] = useState(30);
  if (data === undefined) return <p role="status" className="text-[13px] text-muted">Loading public execution record…</p>;
  if (!data) return null;
  const performance = tradingPerformance(data.trades, data.positions, Date.now());
  const p = performance.periods.find((p) => p.days === days)!;
  const fmt = (v: string) => `${(Number(v) / 10 ** data.decimals).toLocaleString("en-US", { maximumFractionDigits: 5 })} ${data.unit}`;
  return <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5" aria-label="Public performance">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="m-0 font-display text-[1.5rem] text-cream">Public execution record</h2><p className="m-0 text-[12px] text-muted">Real funds · {data.status} · recorded since {new Date(data.createdAt).toLocaleDateString("en-US")}</p></div>
      <div className="flex gap-2" aria-label="Performance period">{[7, 30, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`rounded-full px-3 py-2 text-[13px] ${days === d ? "bg-cream text-ink" : "bg-cream/10 text-cream"}`}>{d}d</button>)}</div></div>
    <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-3">{[
      ["Realized trading PnL", fmt(p.pnl)], ["Return on closed cost", p.costReturnPct === null ? "No closed trades" : `${p.costReturnPct.toFixed(2)}%`],
      ["Confirmed executions", String(p.trades)], ["Winning / losing exits", `${p.wins} / ${p.losses}`],
      ["Realized PnL drawdown", fmt(p.realizedDrawdown)], ["Open position cost · now", `${fmt(performance.openCost)} · ${performance.openPositions} positions`],
    ].map(([label, value]) => <div key={label}><dt className="text-[12px] text-muted">{label}</dt><dd className="m-0 mt-1 font-mono text-[14px] text-cream">{value}</dd></div>)}</dl>
    <p className="m-0 max-w-[85ch] text-[12px] leading-relaxed text-muted">Trading fills include execution costs recorded by the executor. Open cost is not current market value. Return is realized PnL divided by the cost of tokens sold, not portfolio return. Drawdown measures the decline of cumulative realized PnL in native units, not portfolio equity. Funding, token creator fees, AI overhead and Arc market results are separate. No simulated returns appear here.</p>
    <p className="m-0 break-all font-mono text-[11px] text-muted">Strategy r{data.strategy.revision} · SHA-256 {data.strategy.fingerprint}</p>
    {data.truncated ? <p role="status" className="text-[12px] text-coral">Limited to the latest 10,000 executions. Period totals may be incomplete.</p> : null}
    <details><summary className="cursor-pointer text-[13px] text-coral">Verify recent executions</summary><ul className="grid gap-2 pl-4 text-[12px]">{performance.evidence.map((t) => <li key={t.sig}><a className="text-cream underline" href={data.unit === "ETH" ? rhExplorer("tx", t.sig) : solscan("tx", t.sig)} target="_blank" rel="noreferrer">{t.side} · {new Date(t.at).toLocaleString("en-US")} · {t.sig.slice(0, 12)}…</a></li>)}</ul>{!performance.evidence.length ? <p className="text-[12px] text-muted">No confirmed trading executions in this period.</p> : null}</details>
  </section>;
}
