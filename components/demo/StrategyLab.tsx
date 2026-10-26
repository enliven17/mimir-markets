"use client";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { demoReturn, type DemoAgent, type DemoStake } from "@/lib/demo/types";

export default function StrategyLab({ agents, stakes, busy, create }: { agents: DemoAgent[]; stakes: DemoStake[]; busy: boolean; create: (action: unknown) => Promise<void> }) {
  const [source, setSource] = useState("");
  const original = agents.find((a) => a.id === source) ?? agents[0];
  const [metric, setMetric] = useState<"stopLossPct" | "minEdge">("stopLossPct");
  const [a, setA] = useState(10), [b, setB] = useState(20);
  if (!agents.length) return null;
  const selectedMetric = metric === "stopLossPct" && !original.trading.enabled ? "minEdge" : metric === "minEdge" && !original.markets.enabled ? "stopLossPct" : metric;
  return <section className="grid min-w-0 gap-4 rounded-2xl bg-cream/[0.04] p-5" aria-label="Strategy lab">
    <h2 className="m-0 font-display text-[1.6rem] text-cream">Strategy lab</h2>
    <p className="m-0 max-w-[80ch] text-[13px] text-muted">Compare your actual paper results and fork two fresh variants. A paired trial uses the same starting funds, start time and shared feed. Decisions can differ because of AI sampling and the shared AI allowance. This is forward testing, not a historical backtest.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-[12px]"><caption className="sr-only">Strategy versions and paper results</caption><thead className="text-muted"><tr>{["Agent / revision", "Paper return", "Trading PnL", "Market PnL", "Observed trades", "Settings"].map((v) => <th key={v} className="p-2 font-normal">{v}</th>)}</tr></thead><tbody className="text-cream">{agents.map((agent) => <tr key={agent.id} className="border-t border-cream/10">
      <td className="p-2"><Link href={`/demo/${agent.id}`} className="text-coral">{agent.name}</Link><span className="block text-muted">r{agent.strategy?.revision ?? 1} · {agent.strategy?.variant ?? "original"} · {agent.chain}</span><span className="block text-muted">Started {new Date(agent.createdAt).toLocaleString("en-US")}</span></td>
      <td className="p-2">{(demoReturn(agent, stakes.filter((s) => s.agentId === agent.id && s.status === "open").reduce((sum, s) => sum + s.amount, 0)) * 100).toFixed(2)}%</td>
      <td className="p-2">{agent.state.pnl.toFixed(4)} {agent.chain === "robinhood" ? "ETH" : "SOL"}</td><td className="p-2">{agent.state.marketPnl.toFixed(2)} USDC</td><td className="p-2">{agent.state.trades.length}{agent.state.trades.length >= 100 ? "+" : ""}</td>
      <td className="p-2"><details><summary className="cursor-pointer text-coral">{agent.strategy?.fingerprint.slice(0, 12) ?? "Legacy settings"}</summary><pre className="max-w-72 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify({ model: agent.strategy?.model ?? "Legacy model not recorded", thesis: agent.thesis, trading: agent.trading, markets: agent.markets, lineage: agent.strategy }, null, 2)}</pre></details></td>
    </tr>)}</tbody></table></div>
    {agents.length <= 1 ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void create({ action: "trial", source: original.id, metric: selectedMetric, a, b }); }}>
      <label className="grid gap-1 text-[12px] text-muted">Base strategy<select className="input" value={original.id} onChange={(e) => setSource(e.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label className="grid gap-1 text-[12px] text-muted">Setting to compare<select className="input" value={selectedMetric} onChange={(e) => setMetric(e.target.value as typeof metric)}><option value="stopLossPct" disabled={!original.trading.enabled}>Stop loss · %</option><option value="minEdge" disabled={!original.markets.enabled}>Minimum market edge · %</option></select></label>
      <label className="grid gap-1 text-[12px] text-muted">Variant A · %<input className="input" type="number" min={selectedMetric === "stopLossPct" ? 5 : 3} max="50" value={a} onChange={(e) => setA(Number(e.target.value))} /></label>
      <label className="grid gap-1 text-[12px] text-muted">Variant B · %<input className="input" type="number" min={selectedMetric === "stopLossPct" ? 5 : 3} max="50" value={b} onChange={(e) => setB(Number(e.target.value))} /></label>
      <button disabled={busy || a === b || (selectedMetric === "stopLossPct" ? !original.trading.enabled : !original.markets.enabled)} className="btn-primary !w-auto !px-5 disabled:opacity-50">Start paired paper trial</button>
    </form> : <p className="m-0 text-[12px] text-muted">A fresh paired trial needs two free slots. Existing versions retain their own results; no returns are transferred between strategies.</p>}
  </section>;
}
