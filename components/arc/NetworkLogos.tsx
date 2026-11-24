import { MARKET_CHAINS, type MarketChainId } from "@/lib/chains/registry";

/**
 * Official wordmarks of enabled market chains. White marks for the dark theme.
 */
export function NetworkLogos({ className = "h-6", base = true }: { className?: string; base?: boolean }) {
  const showBsc = MARKET_CHAINS.enabled.includes("bsc");
  const showBase = base && MARKET_CHAINS.enabled.includes("base");
  const showArc = MARKET_CHAINS.enabled.includes("arc");
  const shown = [
    ...(showBsc ? [{ id: "bsc", src: "/networks/bsc.svg", alt: "BNB Chain", cls: "h-[90%] w-auto" }] : []),
    ...(showBase ? [{ id: "base", src: "/networks/base.svg", alt: "Base", cls: "h-[85%] w-auto" }] : []),
    ...(showArc ? [{ id: "arc", src: "/networks/arc.svg", alt: "Arc", cls: "h-full w-auto" }] : []),
  ];
  return (
    <span className={`inline-flex items-center ${/\bgap-/.test(className) ? "" : "gap-4"} ${className}`}>
      {shown.map((item, idx) => (
        <span key={item.id} className="inline-flex h-full items-center gap-4">
          {idx > 0 ? <span aria-hidden className="h-[60%] w-px bg-line" /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs, no optimisation to gain */}
          <img src={item.src} alt={item.alt} className={item.cls} />
        </span>
      ))}
    </span>
  );
}

const CHAIN_ICON: Record<MarketChainId, string> = {
  bsc: "/networks/bsc-icon.svg",
  base: "/networks/base-icon.svg",
  arc: "/networks/arc-icon.svg",
};
const CHAIN_LABEL: Record<MarketChainId, string> = {
  bsc: "BNB Chain",
  base: "Base",
  arc: "Arc",
};

/** A market's network: the chain's icon and name, small, for cards, feeds, the market page and positions. */
export function ChainBadge({ chain, className = "", withLabel = true }: { chain: MarketChainId; className?: string; withLabel?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-panel-raised px-2 py-0.5 text-[11px] text-muted ${className}`} title={`On ${CHAIN_LABEL[chain]}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
      <img src={CHAIN_ICON[chain]} alt={withLabel ? "" : CHAIN_LABEL[chain]} className="h-3 w-3" />
      {withLabel ? CHAIN_LABEL[chain] : null}
    </span>
  );
}

/** Pick a market chain (the create form): one button per enabled chain. */
export function ChainPicker({
  chains,
  value,
  onChange,
  hint,
}: {
  chains: readonly MarketChainId[];
  value: MarketChainId;
  onChange: (c: MarketChainId) => void;
  hint?: (c: MarketChainId) => string;
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
