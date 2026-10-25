"use client";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import AgentFace from "@/components/launch/AgentFace";
import { SURFACE } from "@/components/arena/surface";
import { demoReturn, type DemoAgent, type DemoStake } from "@/lib/demo/types";
import { showcasePreviews } from "@/lib/demo/showcase";
import { showcaseSample } from "@/lib/demo/showcase-samples";
import BasketCurve from "@/components/baskets/BasketCurve";

export default function DemoShowcase() {
  const [data, setData] = useState<{ agents: DemoAgent[]; stakes: DemoStake[] }>(() => ({ agents: showcasePreviews(), stakes: [] }));
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/demo?view=directory", { cache: "no-store" });
        const result = await r.json();
        if (!r.ok) throw new Error("Preview agents are temporarily unavailable.");
        if (!cancelled) { setData(result); setError(""); }
      } catch { if (!cancelled) setError("Could not refresh preview agents. Showing the last available previews."); }
    };
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return <section aria-label="All preview agents" className="grid min-w-0 gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="grid gap-1"><span className="font-mono text-[11px] uppercase tracking-widest text-coral">Mimir Preview · limited access · 3 free agents · 7 days</span><h2 className="m-0 font-display text-[1.5rem] text-cream">All preview agents</h2><p className="m-0 max-w-[66ch] text-[14px] text-muted">Explore community agents and Mimir examples across three networks. Open any agent to follow its strategy, paper trades and performance.</p></div>
      <div className="flex flex-wrap items-center gap-4"><Link href="/demo" className="text-[12px] text-coral">Your dashboard ↗</Link><Link href="/demo/new" className="btn-primary !w-auto !px-5">Create your preview agent</Link></div>
    </div>
    <p className="m-0 text-[12px] leading-relaxed text-muted">Community cards show actual paper returns. Mimir example charts and example returns are labelled illustrative scenarios; their recorded paper results are shown separately inside each agent. All funds are virtual.</p>
    {error ? <p role="status" className="m-0 text-[13px] text-muted">{error}</p> : !data.agents.length ? <p role="status" className="m-0 text-[13px] text-muted">No preview agents yet. Create the first one.</p> : null}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {data.agents.map((a) => {
        const open = data.stakes.filter((s) => s.agentId === a.id && s.status === "open").reduce((sum, s) => sum + s.amount, 0);
        const scenario = a.showcaseKey ? showcaseSample(a.showcaseKey) : null;
        const ret = scenario?.totalReturn ?? demoReturn(a, open);
        return <Link key={a.id} href={`/demo/${a.showcaseKey ? `showcase-${a.showcaseKey}` : a.id}`} className={`${SURFACE} grid min-w-0 gap-3 p-4 text-left transition hover:ring-1 hover:ring-coral`}>
          <span className="flex items-center gap-2"><AgentFace seed={a.avatarSeed} size={36} /><span className="font-mono text-[10px] uppercase tracking-widest text-coral">{a.showcaseKey ? "Mimir example" : "Community"}</span></span>
          <span className="truncate text-[15px] text-cream">{a.name}</span>
          <span className="text-[12px] text-muted">{a.chain} · {a.id.startsWith("preview-") ? "Example" : a.status}</span>
          {scenario ? <BasketCurve values={scenario.curve} baseline={1_000} label={`${a.name}: illustrative example scenario`} className="h-14" /> : <span className="flex h-14 items-center text-[12px] text-muted">{a.state.trades.length} trades · {a.state.positions.length} open positions</span>}
          <span className={`font-mono text-[22px] ${ret >= 0 ? "text-win" : "text-[#ff8e88]"}`}>{ret >= 0 ? "+" : ""}{(ret * 100).toFixed(2)}%</span>
          <span className="text-[11px] text-muted">{scenario ? "Illustrative example return" : "Actual paper return"}</span>
        </Link>;
      })}
    </div>
  </section>;
}
