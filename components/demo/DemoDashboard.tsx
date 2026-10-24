"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import AgentFace from "@/components/launch/AgentFace";
import { SURFACE } from "@/components/arena/surface";
import { demoPost } from "@/lib/demo/client";
import DemoUpsell from "./DemoUpsell";
import { DEMO, demoReturn, nativeEquity, type DemoAgent, type DemoBasket, type DemoStake } from "@/lib/demo/types";

type Dashboard = {
  expiresAt: number; agents: DemoAgent[]; stakes: DemoStake[];
  baskets: (DemoBasket & { totalReturn: number; nav: number })[];
};
const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const percent = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const when = (n: number) => new Date(n).toLocaleString();
const unit = (a: DemoAgent) => a.chain === "robinhood" ? "ETH" : "SOL";
const inputClass = "input min-w-0";

export default function DemoDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [basketName, setBasketName] = useState("");
  const [basketThesis, setBasketThesis] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [upsell, setUpsell] = useState(false);
  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setEnabled(result.enabled !== false); setExpired(response.status === 401); if (response.status === 401) setData(null); throw new Error(result.error ?? "Preview is unavailable."); }
      setData(result.session); setEnabled(result.enabled); setExpired(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load preview."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void reload();
    setSelected(new URLSearchParams(window.location.search).get("agent") ?? "");
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  async function act(action: unknown) {
    setBusy(true); setError("");
    try { await demoPost(action); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Preview request failed."); }
    finally { setBusy(false); }
  }
  const agent = data?.agents.find((a) => a.id === selected) ?? data?.agents[0];
  const stakes = data?.stakes.filter((s) => s.agentId === agent?.id).sort((a, b) => b.at - a.at) ?? [];
  const totalBps = Object.values(weights).reduce((sum, v) => sum + Math.round(Number(v || 0) * 100), 0);

  return <div className="grid min-w-0 gap-7">
    <DemoUpsell open={upsell} onClose={() => setUpsell(false)} agentId={agent?.id} used={data?.agents.length ?? 0} />
    <header className="grid gap-3">
      <span className="font-mono text-[12px] uppercase tracking-widest text-coral">Mimir Preview · limited access · 7 days</span>
      <h1 className="m-0 font-display text-app-h1 text-cream">Mimir Preview</h1>
      <p className="m-0 max-w-[68ch] text-[15px] leading-relaxed text-muted">Launch an agent with your rules, follow its paper trades and build a preview basket. Start with 10 virtual SOL or ETH and 1,000 virtual USDC. Your browser keeps your preview session for 7 days.</p>
      <p className="m-0 max-w-[72ch] text-[12px] leading-relaxed text-muted">Agents evaluate shared price snapshots every 5 minutes. AI decisions have a shared allowance; new entries wait when it is used. Paper fills include your slippage setting and market entry fees. Returns are simulated.</p>
      <div className="flex flex-wrap items-center gap-4">
        {enabled && (!data || data.agents.length < DEMO.maxAgents) ? <Link href="/demo/new" className="btn-primary !w-auto !px-5">Create preview agent</Link> : enabled && data ? <button className="btn-primary !w-auto !px-5" onClick={() => setUpsell(true)}>Preview limit reached · go live</button> : null}
        <Link href="/launch" className="text-[14px] text-muted hover:text-cream">Explore live agents →</Link>
        <Link href="/arena" className="text-[14px] text-muted hover:text-cream">Browse markets →</Link>
      </div>
    </header>
    {loading ? <p role="status" className="text-muted">Loading your preview…</p> : null}
    {error ? <div role="alert" className={`${SURFACE} grid gap-3 p-4 text-[14px] text-coral`}>
      <span>{error}</span>
      {enabled ? <div className="flex gap-4"><button disabled={busy} onClick={() => void reload()} className="text-cream">Refresh</button>{expired ? <button disabled={busy} onClick={() => void act({ action: "session" })} className="text-cream">Start a new preview session</button> : null}</div> : null}
    </div> : null}
    {!loading && !data && !error ? <section className={`${SURFACE} grid gap-3 p-6`}>
      <h2 className="m-0 font-display text-[1.5rem] text-cream">Your first agent starts here</h2>
      <p className="m-0 text-[14px] text-muted">Up to 3 agents and 3 baskets. No wallet, token launch or deposit.</p>
    </section> : null}
    {data ? <>
      <p className="m-0 text-[12px] text-muted">{data.agents.length} / {DEMO.maxAgents} agents · {data.baskets.length} / {DEMO.maxBaskets} baskets · session ends {when(data.expiresAt)}</p>
      <section aria-label="Preview agents" className="grid min-w-0 gap-3 sm:grid-cols-3">
        {data.agents.map((a) => {
          const open = data.stakes.filter((s) => s.agentId === a.id && s.status === "open").reduce((sum, s) => sum + s.amount, 0);
          return <button key={a.id} type="button" onClick={() => setSelected(a.id)} aria-pressed={agent?.id === a.id} className={`${SURFACE} grid min-w-0 gap-3 p-4 text-left ${agent?.id === a.id ? "ring-1 ring-coral" : ""}`}>
            <span className="flex items-center gap-3"><AgentFace seed={a.avatarSeed} size={40} /><span className="min-w-0"><span className="block truncate text-cream">{a.name}</span><span className="text-[12px] text-muted">{a.chain} · {a.status}</span></span></span>
            <span className="font-mono text-[20px] text-cream">{percent(demoReturn(a, open))}</span>
            <span className="text-[12px] text-muted">Simulated return</span>
          </button>;
        })}
      </section>
      {agent ? <section className={`${SURFACE} grid min-w-0 gap-5 p-5`} aria-label="Preview agent details">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1"><h2 className="m-0 break-words font-display text-[1.6rem] text-cream">{agent.name}</h2><span className="text-[12px] text-muted">PREVIEW · {agent.chain} · {agent.status}{agent.nextTickAt < agent.expiresAt ? ` · next evaluation ${when(agent.nextTickAt)}` : ""}</span></div>
          {agent.status === "live" || agent.status === "paused" ? <div className="flex gap-4 text-[13px]">
            <button disabled={busy} className="text-coral disabled:opacity-50" onClick={() => void act({ action: "status", id: agent.id, status: agent.status === "live" ? "paused" : "live" })}>{agent.status === "live" ? "Pause" : "Resume"}</button>
            <button disabled={busy} className="text-muted disabled:opacity-50" onClick={() => void act({ action: "status", id: agent.id, status: "killed" })}>Shut down</button>
          </div> : null}
        </header>
        <Link href={`/launch/new?demo=${encodeURIComponent(agent.id)}`} className="btn-primary !w-auto justify-self-start !px-5">Deploy as a real agent</Link>
        {agent.thesis ? <p className="m-0 text-[14px] text-muted">{agent.thesis}</p> : null}
        <dl className="grid gap-3 text-[14px] sm:grid-cols-2 lg:grid-cols-4">
          {agent.trading.enabled ? <><div><dt className="text-muted">Virtual cash</dt><dd className="m-0 font-mono text-cream">{number(agent.state.cash)} {unit(agent)}</dd></div><div><dt className="text-muted">Trading equity</dt><dd className="m-0 font-mono text-cream">{number(nativeEquity(agent.state))} {unit(agent)}</dd></div></> : null}
          {agent.markets.enabled ? <><div><dt className="text-muted">Virtual USDC</dt><dd className="m-0 font-mono text-cream">{number(agent.state.usdc)}</dd></div><div><dt className="text-muted">Market P&amp;L</dt><dd className="m-0 font-mono text-cream">{number(agent.state.marketPnl)} USDC</dd></div></> : null}
        </dl>
        {agent.trading.config && agent.trading.risk ? <details className="text-[13px] text-muted"><summary className="cursor-pointer text-cream">Strategy &amp; risk rules</summary><p>{agent.trading.config.entry.map((c) => `${c.metric} ${c.op} ${c.value}`).join(" · ")}</p><p>Position {agent.trading.risk.positionPct}% · SL {agent.trading.risk.stopLossPct}% · TP {agent.trading.risk.takeProfitPct}% · daily loss {agent.trading.risk.maxDailyLossPct}% · trailing stop {agent.trading.config.trailingStopPct ?? "off"} · max hold {agent.trading.config.maxHoldMinutes ?? "off"}</p></details> : null}
        {agent.state.positions.length ? <div className="grid gap-2"><h3 className="m-0 text-[14px] text-cream">Paper positions</h3>{agent.state.positions.map((p) => <div key={p.mint} className="flex flex-wrap justify-between gap-2 text-[13px] text-muted"><span>{p.symbol}</span><span>{number(p.quantity * p.price)} {unit(agent)} · {percent(p.price / p.entryPrice - 1)}</span></div>)}</div> : null}
        <div className="grid gap-2"><h3 className="m-0 text-[14px] text-cream">Preview trades</h3>
          {!agent.state.trades.length ? <p className="m-0 text-[13px] text-muted">No paper trades yet. Your agent waits for matching rules, a fresh price and an AI decision.</p> : null}
          {agent.state.trades.slice(0, 20).map((t, i) => <div key={`${t.at}-${i}`} className="grid gap-1 border-t border-cream/10 py-2 text-[13px]"><div className="flex flex-wrap justify-between gap-2 text-cream"><span>{t.side.toUpperCase()} {t.symbol} · {number(t.amount)} {unit(agent)}</span><time className="text-muted">{when(t.at)}</time></div><span className="text-muted">{t.reason}{t.side === "sell" ? ` · P&L ${number(t.pnl)} ${unit(agent)}` : ""}</span></div>)}
        </div>
        <div className="grid gap-2"><h3 className="m-0 text-[14px] text-cream">Preview market stakes</h3>
          {!stakes.length ? <p className="m-0 text-[13px] text-muted">No paper stakes yet. The agent waits for an eligible market and enough edge.</p> : null}
          {stakes.map((s) => <div key={s.id} className="grid gap-1 border-t border-cream/10 py-2 text-[13px]"><Link href={`/arena/arc/pool/${s.marketId}`} className="text-coral">{s.question}</Link><span className="text-cream">{s.label} · {number(s.amount)} virtual USDC · {s.status}{s.status !== "open" ? ` · returned ${number(s.payout)}` : ""}</span><span className="text-muted">{s.why}</span></div>)}
        </div>
        <details className="text-[13px] text-muted"><summary className="cursor-pointer text-cream">Decision log</summary><ol className="m-0 mt-3 grid list-none gap-2 p-0">{agent.state.events.slice(0, 30).map((e, i) => <li key={`${e.at}-${i}`}><time>{when(e.at)}</time> · {e.text}</li>)}</ol></details>
      </section> : null}
      <section className={`${SURFACE} grid min-w-0 gap-4 p-5`} aria-label="Preview baskets">
        <h2 className="m-0 font-display text-[1.6rem] text-cream">Preview baskets</h2>
        <p className="m-0 text-[13px] text-muted">Combine your agents with weights. Each basket starts at 1,000 virtual USDC when you create it and tracks its agents’ returns from that point.</p>
        {data.baskets.map((b) => <div key={b.id} className="grid gap-1 rounded-xl bg-cream/5 p-4"><div className="flex flex-wrap justify-between gap-2 text-cream"><span>{b.name}</span><span className="font-mono">{number(b.nav)} USDC · {percent(b.totalReturn)}</span></div><span className="text-[12px] text-muted">{b.members.map((m) => `${data.agents.find((a) => a.id === m.agentId)?.name ?? "Agent"} ${m.weightBps / 100}%`).join(" · ")}</span>{b.thesis ? <p className="m-0 text-[13px] text-muted">{b.thesis}</p> : null}</div>)}
        {data.agents.length > 0 && data.baskets.length < DEMO.maxBaskets ? <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void act({ action: "basket", input: { name: basketName, thesis: basketThesis, members: Object.entries(weights).filter(([, w]) => Number(w) > 0).map(([agentId, w]) => ({ agentId, weightBps: Math.round(Number(w) * 100) })) } }); }}>
          <label className="grid gap-1 text-[13px] text-muted">Basket name<input required minLength={2} maxLength={48} className={inputClass} value={basketName} onChange={(e) => setBasketName(e.target.value)} /></label>
          <label className="grid gap-1 text-[13px] text-muted">Thesis (optional)<textarea maxLength={600} className={inputClass} value={basketThesis} onChange={(e) => setBasketThesis(e.target.value)} /></label>
          <fieldset className="m-0 grid gap-2 border-0 p-0"><legend className="mb-2 text-[13px] text-cream">Agent weights · {totalBps / 100}% / 100%</legend>{data.agents.map((a) => <label key={a.id} className="flex items-center justify-between gap-3 text-[13px] text-muted"><span className="truncate">{a.name}</span><span className="flex items-center gap-2"><input type="number" min={0} max={100} step={0.01} aria-label={`${a.name} weight`} className="input !w-24 font-mono" value={weights[a.id] ?? "0"} onChange={(e) => setWeights((w) => ({ ...w, [a.id]: e.target.value }))} />%</span></label>)}</fieldset>
          <button disabled={busy || totalBps !== 10_000 || !basketName.trim()} className="btn-primary !w-auto justify-self-start !px-5 disabled:opacity-50">Create preview basket</button>
        </form> : null}
      </section>
    </> : null}
  </div>;
}
