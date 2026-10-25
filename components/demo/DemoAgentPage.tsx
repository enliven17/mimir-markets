"use client";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { showcasePreviews } from "@/lib/demo/showcase";
import type { DemoAgent, DemoStake } from "@/lib/demo/types";
import ShowcaseAgentDetails from "./ShowcaseAgentDetails";
import DemoWalletGate from "./DemoWalletGate";
import DemoDashboard from "./DemoDashboard";

function HouseAgent({ id }: { id: string }) {
  const [data, setData] = useState<{ agents: DemoAgent[]; stakes: DemoStake[] }>(() => ({ agents: showcasePreviews(), stakes: [] }));
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/demo?view=showcase&key=${encodeURIComponent(id.replace(/^showcase-/, ""))}`, { cache: "no-store" });
        const value = await r.json();
        if (!r.ok) throw new Error("Current paper activity is temporarily unavailable.");
        if (!cancelled) { if (value.agents?.length) setData(value); setError(""); }
      } catch { if (!cancelled) setError("Current paper activity is temporarily unavailable. Showing the labelled example scenario."); }
    }
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id]);
  const agent = data.agents.find((a) => `showcase-${a.showcaseKey}` === id);
  if (!agent) return <p role="alert" className="text-coral">Preview agent not found.</p>;
  return <div className="grid gap-5">
    <p className="m-0 text-[13px] text-muted">Mimir Preview · limited access · virtual funds. Example scenarios and actual paper results are shown separately.</p>
    {error ? <p role="status" className="m-0 text-[13px] text-muted">{error}</p> : null}
    <ShowcaseAgentDetails agent={agent} stakes={data.stakes.filter((s) => s.agentId === agent.id)} />
  </div>;
}
export default function DemoAgentPage({ id }: { id: string }) {
  return <div className="grid min-w-0 gap-5">
    <Link href={id.startsWith("showcase-") ? "/launch" : "/demo"} className="text-[14px] text-coral">← Preview agents</Link>
    {id.startsWith("showcase-") ? <HouseAgent id={id} /> : <DemoWalletGate><DemoDashboard agentId={id} /></DemoWalletGate>}
  </div>;
}
