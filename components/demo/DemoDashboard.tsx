"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import AgentFace from "@/components/launch/AgentFace";
import { SURFACE } from "@/components/arena/surface";
import { demoGet, demoPost } from "@/lib/demo/client";
import { useWallet } from "@solana/wallet-adapter-react";
import PreviewAgentDetails from "./PreviewAgentDetails";
import DemoUpsell from "./DemoUpsell";
import StrategyLab from "./StrategyLab";
import { trackProductEvent } from "@/lib/product-analytics";
import { DEMO, demoReturn, type DemoAgent, type DemoBasket, type DemoStake } from "@/lib/demo/types";

type Dashboard = {
  expiresAt: number; agents: DemoAgent[]; stakes: DemoStake[];
  baskets: (DemoBasket & { totalReturn: number; nav: number })[];
};
const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const percent = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const when = (n: number) => new Date(n).toLocaleString();
const inputClass = "input min-w-0";

export default function DemoDashboard({ agentId }: { agentId?: string }) {
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? "";
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [basketName, setBasketName] = useState("");
  const [basketThesis, setBasketThesis] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [upsell, setUpsell] = useState(false);
  const reload = useCallback(async () => {
    try {
      const response = await demoGet(owner, agentId);
      const result = await response.json();
      if (!response.ok) { setEnabled(result.enabled !== false); setExpired(response.status === 401); if (response.status === 401) setData(null); throw new Error(result.error ?? "Preview is unavailable."); }
      setData(result.session); setEnabled(result.enabled); setExpired(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load preview."); }
    finally { setLoading(false); }
  }, [owner, agentId]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  async function act(action: unknown) {
    setBusy(true); setError("");
    try { await demoPost(action, owner); if ((action as { action?: string }).action === "trial") trackProductEvent("trial_created", { mode: "paper" }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Preview request failed."); }
    finally { setBusy(false); }
  }
  const agent = agentId ? data?.agents.find((a) => a.id === agentId) : data?.agents[0];
  const stakes = data?.stakes.filter((s) => s.agentId === agent?.id).sort((a, b) => b.at - a.at) ?? [];
  const totalBps = Object.values(weights).reduce((sum, v) => sum + Math.round(Number(v || 0) * 100), 0);

  if (agentId && agent) return <div className="grid min-w-0 gap-4">
    {error ? <p role="alert" className="text-[13px] text-coral">{error}</p> : null}
    <PreviewAgentDetails agent={agent} stakes={stakes} actions={<>
      {agent.status === "live" || agent.status === "paused" ? <div className="flex gap-3 text-[12px]"><button disabled={busy} className="text-coral disabled:opacity-50" onClick={() => void act({ action: "status", id: agent.id, status: agent.status === "live" ? "paused" : "live" })}>{agent.status === "live" ? "Pause" : "Resume"}</button><button disabled={busy} className="text-muted disabled:opacity-50" onClick={() => void act({ action: "status", id: agent.id, status: "killed" })}>Shut down</button></div> : null}
      <Link href={`/launch/new?demo=${encodeURIComponent(agent.id)}`} className="btn-primary !w-auto !px-4 !text-[12px]">Deploy as a real agent ?</Link>
    </>} />
  </div>;

  return <div className="grid min-w-0 gap-7">
    <DemoUpsell open={upsell} onClose={() => setUpsell(false)} agentId={agent?.id} used={data?.agents.length ?? 0} />
    <header className="grid gap-3">
      <span className="font-mono text-[12px] uppercase tracking-widest text-coral">Mimir Preview · limited access · 7 days</span>
      <h1 className="m-0 font-display text-app-h1 text-cream">Mimir Preview</h1>
      <p className="m-0 max-w-[68ch] text-[15px] leading-relaxed text-muted">Launch an agent with your rules, follow its paper trades and build a preview basket. Start with 10 virtual SOL or ETH and 1,000 virtual USDC. Your verified wallet keeps its preview allowance for 7 days.</p>
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
      {enabled ? <div className="flex gap-4"><button disabled={busy} onClick={() => void reload()} className="text-cream">Refresh</button>{expired ? <button disabled={busy} onClick={() => window.location.reload()} className="text-cream">Verify your wallet again</button> : null}</div> : null}
    </div> : null}
    {!loading && !data && !error ? <section className={`${SURFACE} grid gap-3 p-6`}>
      <h2 className="m-0 font-display text-[1.5rem] text-cream">Your first agent starts here</h2>
      <p className="m-0 text-[14px] text-muted">Up to 3 agents and 3 baskets. Wallet verification required. No token launch or deposit.</p>
    </section> : null}
    {data ? <>
      {!agentId ? <StrategyLab agents={data.agents} stakes={data.stakes} busy={busy} create={act} /> : null}
      <p className="m-0 text-[12px] text-muted">{data.agents.length} / {DEMO.maxAgents} agents · {data.baskets.length} / {DEMO.maxBaskets} baskets · session ends {when(data.expiresAt)}</p>
      {!agentId ? <section aria-label="Preview agents" className="grid min-w-0 gap-3 sm:grid-cols-3">
        {data.agents.map((a) => {
          const open = data.stakes.filter((s) => s.agentId === a.id && s.status === "open").reduce((sum, s) => sum + s.amount, 0);
          return <Link key={a.id} href={`/demo/${a.id}`} className={`${SURFACE} grid min-w-0 gap-3 p-4 text-left hover:ring-1 hover:ring-coral`}>
            <span className="flex items-center gap-3"><AgentFace seed={a.avatarSeed} size={40} /><span className="min-w-0"><span className="block truncate text-cream">{a.name}</span><span className="text-[12px] text-muted">{a.chain} · {a.status}</span></span></span>
            <span className="font-mono text-[20px] text-cream">{percent(demoReturn(a, open))}</span>
            <span className="text-[12px] text-muted">Simulated return</span>
          </Link>;
        })}
      </section> : null}
      {agentId && !agent ? <p role="alert" className="text-coral">This preview agent is not in your wallet session.</p> : null}
      {!agentId ? <section className={`${SURFACE} grid min-w-0 gap-4 p-5`} aria-label="Preview baskets">
        <h2 className="m-0 font-display text-[1.6rem] text-cream">Preview baskets</h2>
        <p className="m-0 text-[13px] text-muted">Combine your agents with weights. Each basket starts at 1,000 virtual USDC when you create it and tracks its agents’ returns from that point.</p>
        {data.baskets.map((b) => <div key={b.id} className="grid gap-1 rounded-xl bg-cream/5 p-4"><div className="flex flex-wrap justify-between gap-2 text-cream"><span>{b.name}</span><span className="font-mono">{number(b.nav)} USDC · {percent(b.totalReturn)}</span></div><span className="text-[12px] text-muted">{b.members.map((m) => `${data.agents.find((a) => a.id === m.agentId)?.name ?? "Agent"} ${m.weightBps / 100}%`).join(" · ")}</span>{b.thesis ? <p className="m-0 text-[13px] text-muted">{b.thesis}</p> : null}</div>)}
        {data.agents.length > 0 && data.baskets.length < DEMO.maxBaskets ? <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void act({ action: "basket", input: { name: basketName, thesis: basketThesis, members: Object.entries(weights).filter(([, w]) => Number(w) > 0).map(([agentId, w]) => ({ agentId, weightBps: Math.round(Number(w) * 100) })) } }); }}>
          <label className="grid gap-1 text-[13px] text-muted">Basket name<input required minLength={2} maxLength={48} className={inputClass} value={basketName} onChange={(e) => setBasketName(e.target.value)} /></label>
          <label className="grid gap-1 text-[13px] text-muted">Thesis (optional)<textarea maxLength={600} className={inputClass} value={basketThesis} onChange={(e) => setBasketThesis(e.target.value)} /></label>
          <fieldset className="m-0 grid gap-2 border-0 p-0"><legend className="mb-2 text-[13px] text-cream">Agent weights · {totalBps / 100}% / 100%</legend>{data.agents.map((a) => <label key={a.id} className="flex items-center justify-between gap-3 text-[13px] text-muted"><span className="truncate">{a.name}</span><span className="flex items-center gap-2"><input type="number" min={0} max={100} step={0.01} aria-label={`${a.name} weight`} className="input !w-24 font-mono" value={weights[a.id] ?? "0"} onChange={(e) => setWeights((w) => ({ ...w, [a.id]: e.target.value }))} />%</span></label>)}</fieldset>
          <button disabled={busy || totalBps !== 10_000 || !basketName.trim()} className="btn-primary !w-auto justify-self-start !px-5 disabled:opacity-50">Create preview basket</button>
        </form> : null}
      </section> : null}
    </> : null}
  </div>;
}
