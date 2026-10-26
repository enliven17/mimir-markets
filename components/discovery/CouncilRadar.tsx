"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/navigation";
import FollowButton, { useFollows } from "./FollowButton";
export default function CouncilRadar() {
  const rows = useQuery(api.discovery.radar, {});
  const { wallet, proven, prove, inbox, error } = useFollows();
  return <div className="grid min-w-0 gap-6"><header className="grid gap-3"><h1 className="m-0 font-display text-app-h1 text-cream">Council radar</h1><p className="m-0 max-w-[75ch] text-muted">Find markets where recorded council forecasts differ. Follow markets, topics and agents for in-app updates.</p><p className="m-0 max-w-[85ch] text-[12px] text-muted">Personas may share models and sources. These are recorded opinions, not independent votes or calibrated probabilities. A missing forecast or an abstention without a recorded direction is not counted as opposition. Views can be stale; check their timestamps and evidence.</p></header>
    <section className="grid gap-3 rounded-2xl bg-cream/[0.04] p-5" aria-label="Your watchlist"><h2 className="m-0 font-display text-[1.4rem] text-cream">Your watchlist</h2>
      {!wallet ? <p className="text-[13px] text-muted">Connect your Solana wallet to save follows.</p> : !proven ? <button className="text-left text-[13px] text-coral" onClick={() => void prove().catch(() => undefined)}>Verify wallet to load your private watchlist</button> : null}
      {error ? <p role="alert" className="text-[12px] text-coral">{error}</p> : null}
      {inbox ? <><div className="flex flex-wrap gap-2">{inbox.follows.map((target) => <FollowButton key={target} target={target} label={target} />)}</div><p className="m-0 text-[12px] text-muted">{inbox.follows.length} / 100 follows · updates refresh every minute while open · latest matching events in a bounded 30-day feed</p>
        <ul className="m-0 grid list-none gap-2 p-0">{inbox.items.map((item) => <li key={item.id}><Link className="text-[13px] text-coral" href={item.href}>{item.text}</Link><span className="ml-2 text-[11px] text-muted">{new Date(item.at).toLocaleString("en-US")}</span></li>)}</ul>{!inbox.items.length ? <p className="text-[12px] text-muted">No matching updates yet. New forecasts, side changes, market series and settlement changes appear here after you follow.</p> : null}</> : null}
    </section>
    {rows === undefined ? <p role="status" className="text-muted">Loading council forecasts…</p> : !rows.length ? <p className="text-muted">No directional forecasts on upcoming public markets yet. Recorded directions appear after the council next evaluates them.</p> : null}
    <div className="grid gap-4 sm:grid-cols-2">{rows?.map((m) => <article key={`${m.kind}:${m.marketId}`} className="grid gap-3 rounded-2xl bg-cream/[0.04] p-5"><Link className="font-display text-[1.4rem] text-cream" href={`/arena/arc/${m.kind}/${m.marketId}`}>{m.question}</Link><p className="m-0 text-[13px] text-muted">{m.a} lean {m.labelA} · {m.b} lean {m.labelB} · {m.unknown} without a recorded side</p><p className="m-0 text-[12px] text-muted">{m.a && m.b ? "Council divided" : "Recorded views agree"} · latest view {new Date(m.updatedAt).toLocaleString("en-US")} · deadline {new Date(m.deadline * 1000).toLocaleString("en-US")}</p><div className="flex flex-wrap gap-2"><FollowButton target={`market:${m.kind}:${m.marketId}`} label="Follow market" /><FollowButton target={`topic:${m.category}`} label={`Follow ${m.category}`} /></div></article>)}</div>
  </div>;
}
