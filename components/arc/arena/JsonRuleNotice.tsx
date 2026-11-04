import { resolverSpecFor } from "@/lib/resolver-spec";

/** A source URL may carry legacy JSON metadata without authorizing its comparison. */
export default function JsonRuleNotice({ resolutionUrl }: { resolutionUrl?: string }) {
  if (resolverSpecFor({ resolutionUrl: resolutionUrl ?? "" })?.kind !== "json") return null;
  return <p role="note" className="m-0 rounded-xl bg-panel p-3.5 text-[13px] leading-relaxed text-muted">
    <strong className="text-cream">Custom JSON rule ignored.</strong> Its comparison will not decide this claim. The oracle evaluates the written question using its normal source checks and agent evaluation where needed. The proposal can be disputed during the on-chain dispute window.
  </p>;
}
