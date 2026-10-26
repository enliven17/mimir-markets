import { settlementTimeline, type TimelineMarket } from "@/lib/settlement-timeline";
import { resolverSpecFor } from "@/lib/resolver-spec";
export default function SettlementTimeline({ market, events, now }: { market: TimelineMarket & { question: string; resolutionUrl: string }; events: { name: string; at?: number }[]; now: number }) {
  const spec = resolverSpecFor({ resolutionUrl: market.resolutionUrl });
  let source: string | null = null; try { const u = new URL(market.resolutionUrl); if (["https:", "http:"].includes(u.protocol)) source = u.href; } catch { /* plain text only */ }
  return <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5" aria-label="Resolution timeline"><h2 className="m-0 font-display text-[1.5rem] text-cream">Resolution timeline</h2>
    <p className="m-0 text-[13px] text-muted">{spec?.kind === "price" ? `Price rule: ${spec.symbol} ${spec.op} $${spec.threshold}. The written question and deadline bind the market.` : "The written question, side labels and linked resolution source define the result."}</p>
    <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">{settlementTimeline(market, events, now).map((step) => <li key={step.label} className="flex gap-3"><span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${step.state === "complete" ? "bg-emerald-300" : step.state === "active" ? "bg-coral" : "bg-muted/40"}`} /><div><span className="text-[13px] text-cream">{step.label} · {step.state}</span><span className="block text-[12px] text-muted">{step.at === null ? "Not recorded yet" : new Date(step.at * 1000).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC"}</span></div></li>)}</ol>
    <p className="m-0 text-[12px] text-muted">Council forecasts are opinions. The oracle proposal remains disputable until the on-chain window ends; a dispute goes to the arbiter. The expired-market refund becomes available at {new Date(market.refundAt * 1000).toLocaleString("en-US", { timeZone: "UTC" })} UTC if the contract's conditions are met. Final outcome and payout collection are separate steps.</p>
    {source ? <a className="break-all text-[12px] text-coral" href={source} target="_blank" rel="noreferrer nofollow ugc">Read the resolution source ↗</a> : null}
  </section>;
}
