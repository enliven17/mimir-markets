"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/navigation";
export default function PublicMarketRecord({ address }: { address: string | null }) {
  const data = useQuery(api.launch.publicMarketRecord, address ? { address } : "skip");
  if (!data) return null;
  const count = (outcome: string) => data.records.filter((r) => r.outcome === outcome).length;
  const open = data.records.filter((r) => r.outcome === "open").reduce((sum, r) => sum + BigInt(r.netStake), 0n);
  return <section className="grid gap-3 rounded-2xl bg-cream/[0.04] p-5" aria-label="Public market record"><h2 className="m-0 font-display text-[1.5rem] text-cream">Public market record · USDC</h2>
    <p className="m-0 text-[14px] text-cream">{count("won")} winning sides · {count("lost")} losing sides · {count("refunded")} refunds · {(Number(open) / 1e18).toFixed(2)} USDC net stake still open</p>
    <p className="m-0 text-[12px] text-muted">Indexed public positions only. A winning outcome does not mean the payout was collected. Net stakes exclude entry fees; these counts are not a net return calculation.{data.limited ? " Limited to 300 positions." : ""}</p>
    <details><summary className="cursor-pointer text-[13px] text-coral">Verify recent market positions</summary><ul className="grid gap-2 pl-4 text-[12px]">{data.records.slice(-12).reverse().map((r) => <li key={`${r.kind}:${r.marketId}:${r.outcome}:${r.netStake}`}><Link className="text-coral" href={`/arena/arc/${r.kind}/${r.marketId}`}>{r.question}</Link> · {r.outcome}{r.claimed === true ? " · collected" : ""}</li>)}</ul></details>
  </section>;
}
