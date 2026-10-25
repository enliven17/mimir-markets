"use client";
import { useId, useMemo, useState } from "react";
import { chartWindow, tradeKey, type DemoTokenChart } from "@/lib/demo/charts";
import type { DemoTrade } from "@/lib/demo/types";

export const priceText = (v: number) => v.toLocaleString("en-US", { maximumSignificantDigits: 5 });
const axisText = (v: number) => v > 0 && (v < 0.0001 || v >= 1_000_000) ? v.toExponential(2) : priceText(v);
const time = (v: number) => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function PreviewTokenChart({ token, unit, selected, onSelect }: { token: DemoTokenChart; unit: string; selected: string; onSelect: (trade: DemoTrade) => void }) {
  const id = useId().replace(/:/g, "");
  const [hours, setHours] = useState<number | null>(null);
  const [hover, setHover] = useState<{ at: number; price: number } | null>(null);
  const visible = useMemo(() => chartWindow(token, hours), [token, hours]);
  const geo = useMemo(() => {
    const all = [...visible.points, ...visible.trades];
    if (!all.length) return null;
    const first = Math.min(...all.map((p) => p.at)), last = Math.max(...all.map((p) => p.at));
    const start = first === last ? first - 300_000 : first, end = first === last ? last + 300_000 : last;
    const low = Math.min(...all.map((p) => p.price)), high = Math.max(...all.map((p) => p.price));
    const pad = (high - low || high * 0.1) * 0.18;
    const min = Math.max(0, low - pad), max = high + pad;
    const x = (at: number) => 3 + (at - start) / (end - start) * 94;
    const y = (price: number) => 94 - (price - min) / (max - min) * 88;
    const line = visible.points.map((p, i) => `${i ? "L" : "M"}${x(p.at) * 10},${y(p.price) * 3}`).join(" ");
    return { x, y, start, end, min, max, line };
  }, [visible]);
  const chosen = token.trades.find((t) => tradeKey(t) === selected);
  const last = token.points.at(-1) ?? token.trades.at(-1);
  const readout = hover ?? chosen ?? last;
  return <div className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid gap-1"><span className="font-mono text-[11px] uppercase tracking-[.15em] text-muted">Token price · {unit} per token</span><div className="flex flex-wrap items-baseline gap-3"><strong className="font-mono text-[25px] font-normal tabular-nums text-cream">{readout ? priceText(readout.price) : "—"}</strong><span className="text-[11px] text-muted">{readout ? time(readout.at) : "Waiting for a recorded price"}</span></div></div>
      <div className="flex gap-1 rounded-full bg-cream/5 p-1" role="group" aria-label="Chart time range">{[[1, "1H"], [6, "6H"], [null, "ALL"]].map(([value, label]) => <button key={label} type="button" aria-pressed={hours === value} onClick={() => { setHours(value as number | null); setHover(null); }} className={`rounded-full px-3 py-1.5 font-mono text-[11px] ${hours === value ? "bg-cream text-ink" : "text-muted hover:text-cream"}`}>{label}</button>)}</div>
    </div>
    <div className="relative h-[270px] min-w-0 sm:h-[340px]" aria-label={`${token.symbol} price and paper trades`}>
      {geo ? <>
        <div className="absolute inset-0 bottom-7 right-[66px]" onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const at = geo.start + Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * (geo.end - geo.start);
          const all = [...visible.points, ...visible.trades];
          setHover(all.reduce((nearest, p) => Math.abs(p.at - at) < Math.abs(nearest.at - at) ? p : nearest));
        }} onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs><linearGradient id={`price-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5148" stopOpacity=".22" /><stop offset="100%" stopColor="#ff5148" stopOpacity="0" /></linearGradient></defs>
            {[6, 28, 50, 72, 94].map((y) => <line key={y} x1="0" x2="1000" y1={y * 3} y2={y * 3} stroke="currentColor" className="text-cream/10" strokeDasharray="3 7" vectorEffect="non-scaling-stroke" />)}
            {visible.points.length > 1 ? <><path d={`${geo.line} L${geo.x(visible.points.at(-1)!.at) * 10},300 L${geo.x(visible.points[0].at) * 10},300 Z`} fill={`url(#price-${id})`} /><path d={geo.line} fill="none" stroke="#ff655d" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></> : null}
            {visible.points.map((p) => visible.points.length === 1 ? <circle key={p.at} cx={geo.x(p.at) * 10} cy={geo.y(p.price) * 3} r="3" fill="#ff655d" /> : null)}
            {hover ? <line x1={geo.x(hover.at) * 10} x2={geo.x(hover.at) * 10} y1="0" y2="300" stroke="#f3ead6" strokeOpacity=".3" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {visible.trades.map((t) => <button key={tradeKey(t)} type="button" aria-label={`${t.side === "buy" ? "Buy" : "Sell"} ${t.symbol} at ${priceText(t.price)} ${unit}`} aria-pressed={selected === tradeKey(t)} onClick={() => onSelect(t)} title={`${t.side.toUpperCase()} · ${priceText(t.amount)} ${unit} · ${time(t.at)}`} className={`absolute z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-ink font-mono text-[10px] font-bold shadow-lg transition hover:scale-125 focus-visible:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream ${t.side === "buy" ? "bg-[#92dfbb] text-[#092d20]" : "bg-[#ff7772] text-[#420d0d]"} ${selected === tradeKey(t) ? "ring-2 ring-cream ring-offset-2 ring-offset-ink" : ""}`} style={{ left: `${geo.x(t.at)}%`, top: `${geo.y(t.price)}%` }}>{t.side === "buy" ? "B" : "S"}</button>)}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-7 right-0 top-0 w-[58px] font-mono text-[10px] text-muted">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${6 + i * 22}%` }}>{axisText(geo.max - (geo.max - geo.min) * i / 4)}</span>)}</div>
        <div aria-hidden="true" className="absolute bottom-0 left-0 right-16 flex justify-between gap-2 font-mono text-[9px] text-muted"><span>{time(geo.start)}</span><span>{time(geo.end)}</span></div>
      </> : <div className="absolute inset-0 grid place-items-center rounded-xl bg-cream/[.025] text-[13px] text-muted">Price tracking starts after the first paper trade.</div>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cream/10 pt-3 text-[11px] text-muted"><span className="flex items-center gap-4"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#92dfbb]" />Buy</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#ff7772]" />Sell</span><span className="hidden sm:inline">Click a marker to inspect the fill</span></span><span>{visible.points.length ? `${visible.points.length} recorded quotes · 5m snapshots` : "Fill markers only · price history is collecting"}</span></div>
  </div>;
}
