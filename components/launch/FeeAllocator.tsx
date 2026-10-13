"use client";

/**
 * Where an agent's creator fees go (ported from snipad's FeeAllocator/AllocationBar). The owner splits its 80% of
 * every claim across four buckets; gas & bankroll holds whatever the other three leave, so they always sum to 100
 * (lib/launch/fees-view nudge). Steppers move 5, sliders move 1.
 */
import type { CSSProperties } from "react";

import Chip from "@/components/ui/Chip";
import Slider from "@/components/ui/Slider";
import { BUCKET_ORDER, DEFAULT_ALLOCATION, FEE_BUCKETS, nudge, perSol, slices, type Allocation, type Bucket, type Slice } from "@/lib/launch/fees-view";

const CORAL = "#ff5148";
const CREAM = "#f3ead6";
const DIM = "rgb(243 234 214 / 0.35)";
export const SWATCH: Record<Slice["key"], CSSProperties> = {
  platform: { background: `radial-gradient(circle, ${DIM} 0.9px, transparent 1.1px) 0 0 / 4px 4px` },
  llm: { background: `repeating-linear-gradient(90deg, ${DIM} 0 1px, transparent 1px 4px)` },
  bankroll: { background: CORAL },
  buyback: { background: CREAM },
  creatorPayout: { background: `repeating-linear-gradient(45deg, ${CORAL} 0 1.5px, transparent 1.5px 5px)` },
  holders: { background: `radial-gradient(circle, ${CREAM} 1.2px, transparent 1.4px) 0 0 / 5px 5px` },
};

export function Swatch({ k }: { k: Slice["key"] }) {
  return <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-cream/30" style={SWATCH[k]} />;
}

/** Every claim as one bar: platform, AI costs, then the owner's four buckets. */
export function AllocationBar({ allocation, className = "" }: { allocation: Allocation; className?: string }) {
  const parts = slices(allocation).filter((s) => s.pct > 0);
  const label = parts.map((p) => `${p.label} ${p.pct}%`).join(", ");
  return (
    <div role="img" aria-label={`Fee split: ${label}`} title={label} className={`flex overflow-hidden rounded-full bg-ink-deep ring-1 ring-cream/15 ${className}`}>
      {parts.map((p) => (
        <span key={p.key} className="h-full border-r border-ink-deep last:border-r-0" style={{ ...SWATCH[p.key], width: `${p.pct}%` }} />
      ))}
    </div>
  );
}

const PRESETS: { label: string; a: Allocation }[] = [
  { label: "Default", a: DEFAULT_ALLOCATION },
  { label: "All to gas & bankroll", a: { bankroll: 100, buyback: 0, creatorPayout: 0, holders: 0 } },
  { label: "Holders first", a: { bankroll: 40, buyback: 20, creatorPayout: 0, holders: 40 } },
];

export default function FeeAllocator({ value, onChange }: { value: Allocation; onChange: (a: Allocation) => void }) {
  const same = (a: Allocation) => BUCKET_ORDER.every((b) => a[b] === value[b]);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Starting points">
        {PRESETS.map((p) => (
          <Chip key={p.label} active={same(p.a)} onClick={() => onChange(p.a)}>{p.label}</Chip>
        ))}
      </div>
      <ul className="m-0 grid list-none divide-y divide-cream/10 p-0">
        {BUCKET_ORDER.map((b) => {
          const v = value[b];
          if (b === "bankroll") {
            return (
              <li key={b} className="grid gap-1 py-3">
                <div className="flex items-center gap-2">
                  <Swatch k={b} />
                  <span className="text-[15px] text-cream">{FEE_BUCKETS[b].label}</span>
                  <output aria-live="polite" className="ml-auto font-mono text-[17px] tabular-nums text-cream">{v}%</output>
                </div>
                <p className="m-0 text-[13px] text-muted">{FEE_BUCKETS[b].plain} Gets whatever the other three leave.</p>
              </li>
            );
          }
          const m = b as Exclude<Bucket, "bankroll">;
          const set = (delta: number) => onChange(nudge(value, m, delta));
          return (
            <li key={b} className="grid gap-2 py-3">
              <div className="flex items-center gap-2">
                <Swatch k={b} />
                <span className="min-w-0 truncate text-[15px] text-cream">{FEE_BUCKETS[b].label}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" aria-label={`Less to ${FEE_BUCKETS[b].short}`} disabled={v <= 0} onClick={() => set(-5)} className="grid h-9 w-9 place-items-center rounded-full bg-cream/[0.06] text-cream hover:bg-cream/10 disabled:opacity-30">−</button>
                  <span className="w-12 text-center font-mono text-[17px] tabular-nums text-cream">{v}%</span>
                  <button type="button" aria-label={`More to ${FEE_BUCKETS[b].short}`} disabled={value.bankroll <= 0} onClick={() => set(5)} className="grid h-9 w-9 place-items-center rounded-full bg-cream/[0.06] text-cream hover:bg-cream/10 disabled:opacity-30">+</button>
                </span>
              </div>
              <Slider value={v} min={0} max={100} step={1} aria-label={FEE_BUCKETS[b].label} aria-valuetext={`${v}%`} onChange={(e) => set(Number(e.target.value) - v)} />
              <p className="m-0 text-[13px] text-muted">{FEE_BUCKETS[b].plain}</p>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2">
        <AllocationBar allocation={value} className="h-3.5" />
        <p className="m-0 font-mono text-[12px] leading-5 text-muted">
          <span className="text-coral">of every 1 SOL in fees:</span> {perSol(value, { creator: "to you" })}
        </p>
      </div>
    </div>
  );
}
