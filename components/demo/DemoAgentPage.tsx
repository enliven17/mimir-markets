"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { showcasePreviews } from "@/lib/demo/showcase";
import type { DemoAgent, DemoStake } from "@/lib/demo/types";
import ShowcaseAgentDetails from "./ShowcaseAgentDetails";
import DemoWalletGate from "./DemoWalletGate";
import PreviewAgentDetails from "./PreviewAgentDetails";
import { useWallet } from "@solana/wallet-adapter-react";
import { demoGet, demoPost } from "@/lib/demo/client";

function OwnerControls({ agent, refresh }: { agent: DemoAgent; refresh: () => Promise<void> }) {
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? "";
  const [owns, setOwns] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void demoGet(owner).then(async (r) => {
      if (!r.ok) throw new Error("Open your dashboard to verify access again.");
      const value = await r.json();
      if (!cancelled) setOwns(value.session?.agents.some((a: DemoAgent) => a.id === agent.id) ?? false);
    }).catch(() => { if (!cancelled) setError("Could not check agent ownership. Open your dashboard to retry."); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [owner, agent.id]);
  async function act(status: "live" | "paused" | "killed") {
    setBusy(true); setError("");
    try { await demoPost({ action: "status", id: agent.id, status }, owner); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update agent."); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-2">
    {error ? <p role="alert" className="m-0 text-[12px] text-coral">{error}</p> : null}
    {checking ? <span className="text-[12px] text-muted">Checking ownership…</span> : owns ? <>
      {agent.status === "live" || agent.status === "paused" ? <div className="flex gap-3 text-[12px]"><button disabled={busy} className="text-coral disabled:opacity-50" onClick={() => void act(agent.status === "live" ? "paused" : "live")}>{agent.status === "live" ? "Pause" : "Resume"}</button><button disabled={busy} className="text-muted disabled:opacity-50" onClick={() => void act("killed")}>Shut down</button></div> : null}
      <Link href={`/launch/new?demo=${encodeURIComponent(agent.id)}`} className="btn-primary !w-auto !px-4 !text-[12px]">Deploy as a real agent ↗</Link>
    </> : <Link href="/demo" className="text-[12px] text-coral">Your preview dashboard ↗</Link>}
  </div>;
}

function CommunityAgent({ id }: { id: string }) {
  const [data, setData] = useState<{ agents: DemoAgent[]; stakes: DemoStake[] } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch(`/api/demo?view=directory&agent=${encodeURIComponent(id)}`, { cache: "no-store", signal });
      const value = await r.json();
      if (signal?.aborted) return;
      if (!r.ok) { if (r.status === 404) setData(null); throw new Error(value.error ?? "Could not load preview agent."); }
      setData(value); setError("");
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Could not load preview agent."); }
  }, [id]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => { if (document.visibilityState === "visible") void load(controller.signal); };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  const agent = data?.agents.find((a) => a.id === id);
  return <div className="grid min-w-0 gap-4">
    {error ? <p role="alert" className="text-[13px] text-coral">{error}</p> : null}
    {agent ? <PreviewAgentDetails agent={agent} stakes={data!.stakes} actions={<DemoWalletGate compact><OwnerControls agent={agent} refresh={() => load()} /></DemoWalletGate>} /> : !error ? <p role="status" className="text-muted">Loading preview agent…</p> : null}
  </div>;
}

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
    <Link href="/launch" className="text-[14px] text-coral">← Preview agents</Link>
    {id.startsWith("showcase-") ? <HouseAgent id={id} /> : <CommunityAgent key={id} id={id} />}
  </div>;
}
