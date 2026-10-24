"use client";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import AgentFace from "@/components/launch/AgentFace";
import { SURFACE } from "@/components/arena/surface";
import { demoReturn, nativeEquity, type DemoAgent, type DemoStake } from "@/lib/demo/types";
import { showcasePreviews } from "@/lib/demo/showcase";
import { showcaseSample } from "@/lib/demo/showcase-samples";
import BasketCurve from "@/components/baskets/BasketCurve";

export default function DemoShowcase() {
  const [data, setData] = useState<{ agents: DemoAgent[]; stakes: DemoStake[] }>(() => ({ agents: showcasePreviews(), stakes: [] }));
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/demo?view=showcase", { cache: "no-store" });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error ?? "Preview examples are temporarily unavailable.");
        if (!cancelled) { if (result.agents?.length) setData(result); setError(""); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load preview examples."); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  const agent = data?.agents.find((a) => a.id === selected) ?? data?.agents[0];
  const stakes = data?.stakes.filter((s) => s.agentId === agent?.id) ?? [];
  const sample = agent?.showcaseKey ? showcaseSample(agent.showcaseKey) : null;
  return <div className="grid min-w-0 gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="grid gap-1"><span className="font-mono text-[11px] uppercase tracking-widest text-coral">Mimir Preview · limited access · 3 free agents · 7 days</span><h2 className="m-0 font-display text-[1.5rem] text-cream">Meet our preview agents</h2><p className="m-0 max-w-[66ch] text-[14px] text-muted">Five strategies across three networks. Explore the example simulations and current paper activity, then create your own.</p></div>
      <Link href="/demo/new" className="btn-primary !w-auto !px-5">Create your preview agent</Link>
    </div>
    <p className="m-0 text-[12px] leading-relaxed text-muted">Card charts and positive example returns are illustrative simulation scenarios, not recorded trading results. Current paper performance is shown separately inside each agent.</p>
    {error ? <p role="status" className="m-0 text-[13px] text-muted">Current paper activity is temporarily unavailable. Explore the example previews below.</p> : !data?.agents.length ? <p role="status" className="m-0 text-[13px] text-muted">Preparing preview agents…</p> : null}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {data?.agents.map((a) => {
        const open = data.stakes.filter((s) => s.agentId === a.id && s.status === "open").reduce((sum, s) => sum + s.amount, 0);
        const scenario = a.showcaseKey ? showcaseSample(a.showcaseKey) : null;
        const ret = scenario?.totalReturn ?? demoReturn(a, open);
        return <button key={a.id} onClick={() => setSelected(a.id)} aria-pressed={a.id === agent?.id} className={`${SURFACE} grid min-w-0 gap-3 p-4 text-left ${a.id === agent?.id ? "ring-1 ring-coral" : ""}`}>
          <span className="flex items-center gap-2"><AgentFace seed={a.avatarSeed} size={36} /><span className="font-mono text-[10px] uppercase tracking-widest text-coral">Preview</span></span>
          <span className="truncate text-[15px] text-cream">{a.name}</span>
          <span className="text-[12px] text-muted">{a.chain} · {a.id.startsWith("preview-") ? "Example" : a.status}</span>
          {scenario ? <BasketCurve values={scenario.curve} baseline={1_000} label={`${a.name}: illustrative example scenario`} className="h-14" /> : null}
          <span className="font-mono text-[22px] text-win">{ret >= 0 ? "+" : ""}{(ret * 100).toFixed(2)}%</span>
          <span className="text-[11px] text-muted">Illustrative example return</span>
        </button>;
      })}
    </div>
    {agent ? <section className={`${SURFACE} grid min-w-0 gap-4 p-5`} aria-label="Featured preview agent">
      <div className="flex flex-wrap items-center gap-3"><AgentFace seed={agent.avatarSeed} size={48} /><div><h3 className="m-0 font-display text-[1.5rem] text-cream">{agent.name}</h3><span className="text-[12px] text-coral">PREVIEW · {agent.chain}</span></div></div>
      <p className="m-0 max-w-[76ch] text-[14px] text-muted">{agent.thesis}</p>
      {sample ? <div className="grid gap-3 rounded-xl bg-cream/[0.04] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="m-0 text-[14px] text-cream">Illustrative strategy scenario</h4><span className="text-[11px] text-coral">Sample data · separate from paper results</span></div>
        <BasketCurve values={sample.curve} labels={sample.curve.map((_, i) => `Scenario step ${i}`)} baseline={1_000} interactive label="Illustrative sample equity curve" className="h-32" />
        <dl className="m-0 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4"><div><dt className="text-muted">Example return</dt><dd className="m-0 font-mono text-win">+{(sample.totalReturn * 100).toFixed(2)}%</dd></div><div><dt className="text-muted">Positive steps</dt><dd className="m-0 font-mono text-cream">{(sample.winRate * 100).toFixed(0)}%</dd></div><div><dt className="text-muted">Example drawdown</dt><dd className="m-0 font-mono text-cream">−{(sample.drawdown * 100).toFixed(2)}%</dd></div><div><dt className="text-muted">Scenario steps</dt><dd className="m-0 font-mono text-cream">{sample.steps}</dd></div></dl>
      </div> : null}
      <h4 className="m-0 text-[14px] text-cream">Current paper performance</h4>
      <p className="m-0 text-[13px] text-muted">{agent.id.startsWith("preview-") ? "Paper evaluations begin when the public preview is enabled." : `${(demoReturn(agent, stakes.filter((s) => s.status === "open").reduce((sum, s) => sum + s.amount, 0)) * 100).toFixed(2)}% since this preview started. Example scenario gains are not included.`}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-cream">{agent.trading.enabled ? <span>Trading equity {nativeEquity(agent.state).toFixed(4)} virtual {agent.chain === "robinhood" ? "ETH" : "SOL"}</span> : null}{agent.markets.enabled ? <span>Cash {agent.state.usdc.toFixed(2)} virtual USDC</span> : null}</div>
      {agent.trading.config && agent.trading.risk ? <p className="m-0 text-[12px] text-muted">SL {agent.trading.risk.stopLossPct}% · TP {agent.trading.risk.takeProfitPct}% · position {agent.trading.risk.positionPct}% · {agent.trading.config.entry.map((r) => `${r.metric} ${r.op} ${r.value}`).join(" · ")}</p> : null}
      <div className="grid gap-2"><h4 className="m-0 text-[14px] text-cream">Recent paper activity</h4>
        {!agent.state.trades.length && !stakes.length ? <p className="m-0 text-[13px] text-muted">Waiting for matching rules, fresh quotes and an AI decision. No paper trade is forced.</p> : null}
        {agent.state.trades.slice(0, 5).map((t, i) => <p key={`${t.at}-${i}`} className="m-0 text-[13px] text-muted"><span className="text-cream">{t.side.toUpperCase()} {t.symbol}</span> · {t.amount.toFixed(4)} virtual {agent.chain === "robinhood" ? "ETH" : "SOL"} · {t.reason}</p>)}
        {stakes.slice(-5).reverse().map((s) => <Link key={s.id} href={`/arena/arc/pool/${s.marketId}`} className="text-[13px] text-coral">{s.question} · {s.label} · {s.amount.toFixed(2)} virtual USDC · {s.status}</Link>)}
      </div>
      <details className="text-[13px] text-muted"><summary className="cursor-pointer text-cream">Decision log</summary><ol className="mt-3 grid list-none gap-2 p-0">{agent.state.events.slice(0, 8).map((e, i) => <li key={`${e.at}-${i}`}>{e.text}</li>)}</ol></details>
    </section> : null}
  </div>;
}
