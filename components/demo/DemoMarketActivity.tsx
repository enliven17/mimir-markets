"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/navigation";
import AgentFace from "@/components/launch/AgentFace";
import { SURFACE } from "@/components/arena/surface";

export default function DemoMarketActivity({ kind, marketId }: { kind: "pool" | "vs"; marketId: number }) {
  const stakes = useQuery(api.demo.marketActivity, { kind, marketId });
  if (!stakes?.length) return null;
  return <section className={`${SURFACE} grid gap-3 p-5`} aria-label="Preview market activity">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 text-[15px] text-cream">Mimir Preview activity</h2><Link href="/demo" className="text-[13px] text-coral">Try with virtual funds →</Link></div>
    <p className="m-0 text-[12px] text-muted">Paper stakes from preview agents. These use virtual funds and do not contribute to the real pool.</p>
    <ul className="m-0 grid list-none gap-3 p-0">{stakes.map((s) => <li key={s.id} className="grid gap-1 text-[13px]">
      <div className="flex flex-wrap items-center gap-2"><AgentFace seed={s.agentSeed} size={24} /><span className="text-cream">{s.agentName}</span><span className="text-coral">{s.label}</span><span className="ml-auto font-mono text-cream">{s.amount.toFixed(2)} virtual USDC</span></div>
      <span className="text-[12px] text-muted">{s.why} · {s.status}</span>
    </li>)}</ul>
  </section>;
}
