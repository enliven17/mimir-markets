"use client";
import { useId, useMemo, useState } from "react";
import { chartPrice, chartTimeline, chartWindow, tradeKey, type DemoTokenChart } from "@/lib/demo/charts";
import type { DemoTrade } from "@/lib/demo/types";

export const priceText = (v: number) => chartPrice(v, 5);
const time = (v: number) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function PreviewTokenChart({ token, unit, selected, onSelect }: { token: DemoTokenChart; unit: string; selected: string; onSelect: (trade: DemoTrade) => void }) {
  const id = useId().replace(/:/g, "");
  const [hours, setHours] = useState<number | null>(null);
  const [hover, setHover] = useState<{ at: number; price: number } | null>(null);
  const visible = useMemo(() => chartWindow(token, hours), [token, hours]);
  const timeline = useMemo(() => chartTimeline(visible), [visible]);
  const geo = useMemo(() => {
    const all = [...timeline.points, ...visible.trades];
    if (!all.length) return null;
    const first = Math.min(...all.map((p) => p.at)), last = Math.max(...all.map((p) => p.at));
    const start = first === last ? first - 300_000 : first, end = first === last ? last + 300_000 : last;
    const low = Math.min(...all.map((p) => p.price)), high = Math.max(...all.map((p) => p.price));
    const pad = (high - low || high * 0.1) * 0.12;
    const min = Math.max(0, low - pad), max = high + pad;
    const x = (at: number) => 3 + (at - start) / (end - start) * 94;
    const y = (price: number) => 92 - (price - min) / (max - min) * 84;
    const line = timeline.points.map((p, i) => `${i ? "L" : "M"}${x(p.at) * 10},${y(p.price) * 3}`).join(" ");
    const ticks = Array.from({ length: 5 }, (_, i) => chartPrice(max - (max - min) * i / 4));
    const axisWidth = Math.min(112, Math.max(64, ...ticks.map((label) => label.length * 6 + 12)));
    const color = timeline.points.at(-1)!.price >= timeline.points[0].price ? "#92dfbb" : "#ff7772";
    return { x, y, start, end, line, ticks, axisWidth, color };
  }, [timeline, visible.trades]);
  const chosen = visible.trades.find((t) => tradeKey(t) === selected);
  const last = timeline.points.at(-1);
  const readout = hover ?? chosen ?? last;
  return <div className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid min-w-0 gap-1"><span className="font-mono text-[11px] uppercase tracking-[.15em] text-muted">Token price · {unit} per token</span><div className="flex flex-wrap items-baseline gap-3"><strong className="break-all font-mono text-[23px] font-normal tabular-nums text-cream sm:text-[25px]">{readout ? priceText(readout.price) : "—"}</strong><span className="text-[11px] text-muted">{readout ? time(readout.at) : "Waiting for a recorded price"}</span></div></div>
      <div className="flex gap-1 rounded-full bg-cream/5 p-1" role="group" aria-label="Chart time range">{[[1, "1H"], [6, "6H"], [null, "ALL"]].map(([value, label]) => <button key={label} type="button" aria-pressed={hours === value} onClick={() => { setHours(value as number | null); setHover(null); }} className={`rounded-full px-3 py-1.5 font-mono text-[11px] ${hours === value ? "bg-cream text-ink" : "text-muted hover:text-cream"}`}>{label}</button>)}</div>
    </div>
    <div className="relative h-[270px] min-w-0 sm:h-[340px]" aria-label={`${token.symbol} price and paper trades`}>
      {geo ? <>
        <div className="absolute bottom-7 left-0 top-0" style={{ right: geo.axisWidth }} onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = ((e.clientX - box.left) / box.width - 0.03) / 0.94;
          const at = geo.start + Math.max(0, Math.min(1, ratio)) * (geo.end - geo.start);
          setHover(timeline.points.reduce((nearest, p) => Math.abs(p.at - at) < Math.abs(nearest.at - at) ? p : nearest));
        }} onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs><linearGradient id={`price-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={geo.color} stopOpacity=".16" /><stop offset="100%" stopColor={geo.color} stopOpacity="0" /></linearGradient></defs>
            {[8, 29, 50, 71, 92].map((y) => <line key={y} x1="0" x2="1000" y1={y * 3} y2={y * 3} stroke="currentColor" className="text-cream/10" strokeDasharray="3 7" vectorEffect="non-scaling-stroke" />)}
            {timeline.points.length > 1 ? <path d={`${geo.line} L${geo.x(last!.at) * 10},300 L${geo.x(timeline.points[0].at) * 10},300 Z`} fill={`url(#price-${id})`} /> : null}
            {timeline.segments.map(({ from, to, gap }) => <path key={to.at} data-testid={gap ? "price-gap" : "price-quotes"} d={`M${geo.x(from.at) * 10},${geo.y(from.price) * 3} L${geo.x(to.at) * 10},${geo.y(to.price) * 3}`} fill="none" stroke={geo.color} strokeWidth="2" strokeOpacity={gap ? 0.6 : 1} strokeDasharray={gap ? "4 5" : undefined} strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
            {visible.trades.map((t) => {
              const anchor = timeline.points.find((p) => p.at === t.at)!;
              return anchor.price !== t.price ? <line key={tradeKey(t)} x1={geo.x(t.at) * 10} x2={geo.x(t.at) * 10} y1={geo.y(anchor.price) * 3} y2={geo.y(t.price) * 3} stroke={t.side === "buy" ? "#92dfbb" : "#ff7772"} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" /> : null;
            })}
            {hover ? <line x1={geo.x(hover.at) * 10} x2={geo.x(hover.at) * 10} y1="0" y2="300" stroke="#f3ead6" strokeOpacity=".3" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {last ? <span aria-hidden="true" className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${geo.x(last.at)}%`, top: `${geo.y(last.price)}%`, background: geo.color }} /> : null}
          {hover ? <span aria-hidden="true" className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cream bg-ink" style={{ left: `${geo.x(hover.at)}%`, top: `${geo.y(hover.price)}%` }} /> : null}
          {visible.trades.map((t) => <button key={tradeKey(t)} type="button" aria-label={`${t.side === "buy" ? "Buy" : "Sell"} ${t.symbol} at ${priceText(t.price)} ${unit}`} aria-pressed={selected === tradeKey(t)} onClick={() => onSelect(t)} title={`${t.side.toUpperCase()} · ${priceText(t.amount)} ${unit} · ${time(t.at)}`} className={`absolute z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-ink font-mono text-[10px] font-bold shadow-lg transition hover:scale-125 focus-visible:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream ${t.side === "buy" ? "bg-[#92dfbb] text-[#092d20]" : "bg-[#ff7772] text-[#420d0d]"} ${selected === tradeKey(t) ? "ring-2 ring-cream ring-offset-2 ring-offset-ink" : ""}`} style={{ left: `${geo.x(t.at)}%`, top: `${geo.y(t.price)}%` }}>{t.side === "buy" ? "B" : "S"}</button>)}
        </div>
        <div data-testid="price-axis" aria-hidden="true" className="pointer-events-none absolute bottom-7 right-0 top-0 font-mono text-[10px] tabular-nums text-muted" style={{ width: geo.axisWidth - 8 }}>{geo.ticks.map((label, i) => <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${8 + i * 21}%` }}>{label}</span>)}</div>
        <div aria-hidden="true" className="absolute bottom-0 left-0 flex justify-between gap-2 font-mono text-[9px] text-muted" style={{ right: geo.axisWidth }}><span>{time(geo.start)}</span><span>{time(geo.end)}</span></div>
      </> : <div className="absolute inset-0 grid place-items-center rounded-xl bg-cream/[.025] text-[13px] text-muted">Price tracking starts after the first paper trade.</div>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cream/10 pt-3 text-[11px] text-muted"><span className="flex flex-wrap items-center gap-3"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#92dfbb]" />Buy</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#ff7772]" />Sell</span>{timeline.segments.some((s) => s.gap) ? <span title="Dashed segments connect recorded fills or gaps in observed prices. No missing prices are backfilled."><i className="mr-1.5 inline-block w-4 border-t border-dashed border-cream/40 align-middle" />Gaps / fills</span> : null}</span><span>{visible.points.length} quotes · {visible.trades.length} fills</span></div>
  </div>;
}
