import { MARKET_CHAINS } from "@/lib/chains/registry";

/**
 * Official wordmarks of enabled market chains. Base first; Arc returns automatically when re-enabled.
 * `base=false` suppresses Base without making a dormant Arc visible. White marks for the dark theme.
 */
export function NetworkLogos({ className = "h-6", base = true }: { className?: string; base?: boolean }) {
  const showBase = base && MARKET_CHAINS.enabled.includes("base");
  const showArc = MARKET_CHAINS.enabled.includes("arc");
  return (
    <span className={`inline-flex items-center ${/\bgap-/.test(className) ? "" : "gap-4"} ${className}`}>
      {showBase ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs, no optimisation to gain */}
          <img src="/networks/base.svg" alt="Base" className="h-[85%] w-auto" />
          {showArc ? <span aria-hidden className="h-[60%] w-px bg-line" /> : null}
        </>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {showArc ? <img src="/networks/arc.svg" alt="Arc" className="h-full w-auto" /> : null}
    </span>
  );
}

const CHAIN_ICON = { base: "/networks/base-icon.svg", arc: "/networks/arc-icon.svg" } as const;
const CHAIN_LABEL = { base: "Base", arc: "Arc" } as const;

/** A market's network: the chain's icon and name, small, for cards, feeds, the market page and positions. */
export function ChainBadge({ chain, className = "", withLabel = true }: { chain: "base" | "arc"; className?: string; withLabel?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-panel-raised px-2 py-0.5 text-[11px] text-muted ${className}`} title={`On ${CHAIN_LABEL[chain]}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
      <img src={CHAIN_ICON[chain]} alt={withLabel ? "" : CHAIN_LABEL[chain]} className="h-3 w-3" />
      {withLabel ? CHAIN_LABEL[chain] : null}
    </span>
  );
}

/** Pick a market chain (the create form): one button per enabled chain, the primary (Base) first. */
export function ChainPicker({
  chains,
  value,
  onChange,
  hint,
}: {
  chains: readonly ("base" | "arc")[];
  value: "base" | "arc";
  onChange: (c: "base" | "arc") => void;
  hint?: (c: "base" | "arc") => string;
}) {
  return (
    <div role="radiogroup" aria-label="Network" className="grid grid-cols-2 gap-2">
      {chains.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={`grid gap-1 rounded-xl p-3.5 text-left ${value === c ? "bg-panel-raised shadow-[inset_0_0_0_1px_rgb(255_81_72/.6)]" : "bg-panel"}`}
        >
          <span className="flex items-center gap-2 text-[14px] text-cream">
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
            <img src={CHAIN_ICON[c]} alt="" className="h-4 w-4" />
            {CHAIN_LABEL[c]}
          </span>
          {hint ? <span className="text-[12px] leading-snug text-muted">{hint(c)}</span> : null}
        </button>
      ))}
    </div>
  );
}
