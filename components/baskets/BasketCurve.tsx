"use client";

/**
 * A basket's replayed NAV curve as inline SVG: the line draws itself in, the
 * area under it fades up, the last point pulses. `interactive` adds a
 * crosshair that reads out the day and NAV under the pointer (detail page);
 * the directory cards use the quiet version.
 *
 * Still an SVG, not a chart library, for one line (see BasketDetailClient).
 */
import { useId, useMemo, useState } from "react";

import { formatUsdcBare } from "@/lib/money";

interface Props {
  values: number[];
  /** One label per value (the day), for the crosshair readout. */
  labels?: string[];
  /** Drawn as a dashed line: where the basket started. */
  baseline?: number;
  interactive?: boolean;
  className?: string;
  label: string;
}

const W = 100;
const H = 40;
const PAD = 3;

export default function BasketCurve({ values, labels, baseline, interactive = false, className = "", label }: Props) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const all = baseline === undefined ? values : [...values, baseline];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const x = (i: number) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * W);
    const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
    const pts = values.map((v, i) => [x(i), y(v)] as const);
    const line = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
    return { pts, line, area: `${line} L${W},${H} L0,${H} Z`, base: baseline === undefined ? null : y(baseline) };
  }, [values, baseline]);

  const up = values[values.length - 1] >= (baseline ?? values[0]);
  const tone = up ? "var(--coral)" : "var(--danger)";
  const last = geo.pts[geo.pts.length - 1];
  const at = hover === null ? null : geo.pts[hover];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setHover(Math.round(t * (values.length - 1)));
  }

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-full w-full overflow-visible"
        role="img"
        aria-label={label}
        onPointerMove={interactive ? onMove : undefined}
        onPointerLeave={interactive ? () => setHover(null) : undefined}
      >
        <defs>
          {/* Reveals line and area left to right: a dash animation breaks with non-scaling strokes. */}
          <clipPath id={`clip-${id}`}>
            <rect width={W} height={H} className="curve-clip" />
          </clipPath>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.base !== null ? (
          <line
            x1="0"
            x2={W}
            y1={geo.base}
            y2={geo.base}
            stroke="rgb(243 234 214 / 0.18)"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <g clipPath={`url(#clip-${id})`}>
          <path d={geo.area} fill={`url(#fill-${id})`} className="curve-area" />
          <path
            d={geo.line}
            fill="none"
            stroke={tone}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        {at ? (
          <line x1={at[0]} x2={at[0]} y1="0" y2={H} stroke="rgb(243 234 214 / 0.3)" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      {/* Dots as HTML so they stay round on a stretched (preserveAspectRatio="none") SVG. */}
      <span
        aria-hidden
        className="curve-dot pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%`, background: tone, color: tone }}
      />
      {at && hover !== null ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink"
            style={{ left: `${(at[0] / W) * 100}%`, top: `${(at[1] / H) * 100}%`, background: tone }}
          />
          <span
            className="pointer-events-none absolute top-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-panel-raised px-2.5 py-1.5 font-mono text-[11px] text-cream shadow-card"
            style={{ left: `${Math.min(88, Math.max(12, (at[0] / W) * 100))}%` }}
          >
            {labels?.[hover] ? <span className="text-muted">{labels[hover]} · </span> : null}
            {formatUsdcBare(values[hover])} USDC
          </span>
        </>
      ) : null}
    </div>
  );
}
