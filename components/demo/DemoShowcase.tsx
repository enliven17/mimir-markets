"use client";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import AgentFace from "@/components/launch/AgentFace";
import { SURFACE } from "@/components/arena/surface";
import { demoReturn, type DemoAgent, type DemoStake } from "@/lib/demo/types";
import { showcasePreviews } from "@/lib/demo/showcase";
import { showcaseSample } from "@/lib/demo/showcase-samples";
import BasketCurve from "@/components/baskets/BasketCurve";
import { useWallet } from "@solana/wallet-adapter-react";
import { demoGet } from "@/lib/demo/client";

export default function DemoShowcase() {
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? "";
  const [mine, setMine] = useState<{ owner: string; agents: DemoAgent[]; stakes: DemoStake[] } | null>(null);
  const [privateError, setPrivateError] = useState("");
  const [verify, setVerify] = useState(false);
  const [data, setData] = useState<{ agents: DemoAgent[]; stakes: DemoStake[] }>(() => ({ agents: showcasePreviews(), stakes: [] }));
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
  useEffect(() => {
    let cancelled = false;
    setPrivateError(""); setVerify(false);
    if (!owner) { setMine(null); return; }
    async function load() {
      try {
        const r = await demoGet(owner);
        if (cancelled) return;
        if (r.status === 401) { setMine(null); setVerify(true); return; }
        const value = await r.json();
        if (!r.ok) throw new Error("Could not refresh your preview agents.");
        if (!cancelled) { setMine({ owner, agents: value.session?.agents ?? [], stakes: value.session?.stakes ?? [] }); setVerify(false); setPrivateError(""); }
      } catch { if (!cancelled) setPrivateError("Could not refresh your preview agents. Open your dashboard to retry."); }
    }
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [owner]);
  const own = mine?.owner === owner && owner ? mine : null;
  return <div className="grid min-w-0 gap-5">
    {owner ? <section aria-label="Your preview agents" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 font-display text-[22px] text-cream">Your preview agents</h2><Link href="/demo" className="text-[12px] text-coral">Your dashboard ↗</Link></div>
      {verify ? <p className="m-0 text-[13px] text-muted"><Link href="/demo" className="text-coral">Verify your wallet</Link> to load its preview agents.</p> : null}
      {privateError ? <p role="status" className="m-0 text-[12px] text-muted">{privateError}</p> : null}
      {own?.agents.length ? <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">{own.agents.map((a) => {
        const staked = own.stakes.filter((s) => s.agentId === a.id && s.status === "open").reduce((sum, s) => sum + s.amount, 0);
        const ret = demoReturn(a, staked);
        return <Link key={a.id} href={`/demo/${a.id}`} className={`${SURFACE} grid gap-4 border border-coral/20 p-5 transition hover:border-coral/60`}>
          <div className="flex min-w-0 items-center gap-3"><AgentFace seed={a.avatarSeed} size={46} /><div className="grid min-w-0 gap-1"><span className="truncate text-[16px] text-cream">{a.name}</span><span className="font-mono text-[10px] uppercase tracking-wider text-coral">Your agent · {a.chain}</span></div><span className="ml-auto text-[11px] text-muted">{a.status}</span></div>
          <div className="flex items-end justify-between gap-3"><span className={`font-mono text-[27px] ${ret >= 0 ? "text-[#92dfbb]" : "text-[#ff8e88]"}`}>{ret >= 0 ? "+" : ""}{(ret * 100).toFixed(2)}%<span className="mt-1 block text-[10px] text-muted">Actual paper return</span></span><span className="text-right text-[11px] text-muted">{a.state.trades.length} trades<br />{a.state.positions.length} open positions</span></div>
        </Link>;
      })}</div> : own && !privateError ? <p className="m-0 text-[13px] text-muted">Your agents will appear here as soon as you create one.</p> : null}
    </section> : null}
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
        return <Link key={a.id} href={`/demo/showcase-${a.showcaseKey}`} className={`${SURFACE} grid min-w-0 gap-3 p-4 text-left transition hover:ring-1 hover:ring-coral`}>
          <span className="flex items-center gap-2"><AgentFace seed={a.avatarSeed} size={36} /><span className="font-mono text-[10px] uppercase tracking-widest text-coral">Preview</span></span>
          <span className="truncate text-[15px] text-cream">{a.name}</span>
          <span className="text-[12px] text-muted">{a.chain} · {a.id.startsWith("preview-") ? "Example" : a.status}</span>
          {scenario ? <BasketCurve values={scenario.curve} baseline={1_000} label={`${a.name}: illustrative example scenario`} className="h-14" /> : null}
          <span className="font-mono text-[22px] text-win">{ret >= 0 ? "+" : ""}{(ret * 100).toFixed(2)}%</span>
          <span className="text-[11px] text-muted">Illustrative example return</span>
        </Link>;
      })}
    </div>

  </div>;
}
