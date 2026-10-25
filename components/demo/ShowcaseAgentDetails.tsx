"use client";
import { Link } from "@/i18n/navigation";
import AgentFace from "@/components/launch/AgentFace";
import { SURFACE } from "@/components/arena/surface";
import BasketCurve from "@/components/baskets/BasketCurve";
import { showcaseSample } from "@/lib/demo/showcase-samples";
import { demoReturn, nativeEquity, type DemoAgent, type DemoStake } from "@/lib/demo/types";
export default function ShowcaseAgentDetails({ agent, stakes }: { agent: DemoAgent; stakes: DemoStake[] }) {
  const sample = agent.showcaseKey ? showcaseSample(agent.showcaseKey) : null;
  return <section className={`${SURFACE} grid min-w-0 gap-4 p-5`} aria-label="Featured preview agent">
      <div className="flex flex-wrap items-center gap-3"><AgentFace seed={agent.avatarSeed} size={48} /><div><p className="m-0 font-display text-[1.5rem] text-cream">{agent.name}</p><span className="text-[12px] text-coral">PREVIEW · {agent.chain}</span></div></div>
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
    </section>;
}
