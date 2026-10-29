"use client";

/**
 * Copy an agent from its page: pick its Arc market stakes, its Solana trades or both, set a cap per copy, fund the
 * copy wallets, stop, withdraw. Every change is signed by the wallet.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { signedPost } from "@/lib/launch/client";
import { solscan } from "@/lib/launch/council-view";
import { arcExplorerUrl } from "@/lib/arc/config";
import { ExternalMark } from "@/components/ExternalMark";
import { DEFAULT_COPY_RISK, type CopyRiskPolicy } from "@/lib/launch/copy-risk";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { tradingPerformance } from "@/lib/launch/performance";
import { trackProductEvent } from "@/lib/product-analytics";

type Status = {
  risk: CopyRiskPolicy;
  can: { solana: boolean; arc: boolean };
  sub: null | {
    active: boolean;
    pausedReason: string | null;
    realizedPnl: string;
    receiptsLimited: boolean;
    solana: null | { address: string; on: boolean; maxPerTradeSol: number; spendableSol: number | null };
    arc: null | { address: string; on: boolean; maxPerStakeUsdc: number; balanceUsdc: number | null };
    holdings: { mint: string; tokens: string }[];
  };
};

export default function CopyPanel({ slug, ticker }: { slug: string; ticker: string }) {
  const { publicKey, signMessage } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  const [st, setSt] = useState<Status | null>(null);
  const [arcOn, setArcOn] = useState(true);
  const [solOn, setSolOn] = useState(false);
  const [maxStake, setMaxStake] = useState("2");
  const [maxTrade, setMaxTrade] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [wd, setWd] = useState({ chain: "arc" as "arc" | "solana", amount: "" });
  const [risk, setRisk] = useState<CopyRiskPolicy>(DEFAULT_COPY_RISK);
  const performance = useQuery(api.launch.performance, { slug });

  const load = useCallback(async () => {
    if (!owner) return;
    const res = await fetch(`/api/launch/${slug}/copy?follower=${owner}`).catch(() => null);
    if (!res?.ok) return;
    const s = (await res.json()) as Status;
    setSt(s);
    setRisk(s.risk);
    if (s.sub) {
      setArcOn(!!s.sub.arc?.on);
      setSolOn(!!s.sub.solana?.on);
      if (s.sub.arc) setMaxStake(String(s.sub.arc.maxPerStakeUsdc));
      if (s.sub.solana) setMaxTrade(String(s.sub.solana.maxPerTradeSol));
    } else if (!s.can.arc && s.can.solana) {
      setArcOn(false);
      setSolOn(true);
    }
  }, [owner, slug]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!owner || !st?.sub?.active) return;
    const funded = (st.sub.solana?.spendableSol ?? 0) > 0 || (st.sub.arc?.balanceUsdc ?? 0) > 0;
    if (!funded) return;
    try { const key = `mimir.copy-funded:${owner}:${slug}`; if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); trackProductEvent("copy_funded", { mode: "live" }); } catch { /* Analytics never block copying. */ }
  }, [owner, slug, st]);

  if (!owner || !signMessage || !st || (!st.can.arc && !st.can.solana)) return null;

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await fn());
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };
  const save = (active: boolean) =>
    act(async () => {
      const body = {
        active,
        risk,
        ...(st.can.arc ? { arc: { on: arcOn, maxPerStakeUsdc: Number(maxStake) || 0.1 } } : {}),
        ...(st.can.solana ? { solana: { on: solOn, maxPerTradeSol: Number(maxTrade) || 0.01 } } : {}),
      };
      await signedPost(`/api/launch/${slug}/copy`, { owner, signMessage, action: "copy", agent: slug, body });
      if (active && !st.sub?.active) trackProductEvent("copy_started", { mode: "live" });
      return active ? "Copying. Fund the copy wallets below." : "Stopped: no new copies. What you hold still exits with the agent.";
    });
  const sub = st.sub;

  const drain = () =>
    act(async () => {
      await signedPost(`/api/launch/${slug}/copy/drain`, { owner, signMessage, action: "copy-drain", agent: slug, body: {} });
      return "Selling your copied tokens now. Their SOL is free to withdraw in a minute.";
    });
  const side = (on: boolean) =>
    `grid content-start gap-3 rounded-2xl p-4 transition-colors ${on ? "bg-[rgb(36_24_25/.95)] shadow-[inset_0_0_0_1px_rgb(255_81_72/.45)]" : "bg-cream/[0.03] shadow-[inset_0_0_0_1px_rgb(243_234_214/.06)]"}`;

  return (
    <section className="grid gap-5 rounded-2xl bg-[rgb(27_19_20/.93)] p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 font-display text-[1.5rem] leading-none text-cream">Copy ${ticker}</h2>
          <p className="m-0 max-w-[60ch] text-[13px] text-muted">Its moves, from wallets of your own, inside your limits. Stop and withdraw any time.</p>
        </div>
        {sub ? (
          <span className={`rounded-full px-3 py-1 text-[12px] ${sub.active ? "bg-emerald-400/10 text-emerald-300" : "bg-cream/[0.06] text-muted"}`}>
            {sub.active ? "Copying" : sub.pausedReason ? `Paused: ${sub.pausedReason}` : "Stopped"}
          </span>
        ) : null}
      </div>

      <div className={`grid gap-3 ${st.can.arc && st.can.solana ? "sm:grid-cols-2" : ""}`}>
        {st.can.arc ? (
          <div className={side(arcOn)}>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="grid gap-0.5">
                <span className="text-[14px] text-cream">Market stakes</span>
                <span className="text-[12px] text-muted">Same market, same side, on Arc</span>
              </span>
              <input type="checkbox" role="switch" className="switch" checked={arcOn} onChange={(e) => setArcOn(e.target.checked)} />
            </label>
            {arcOn ? (
              <label className="grid gap-1.5">
                <span className="text-[12px] text-muted">Most per stake</span>
                <span className="flex items-center gap-2">
                  <input className="input font-mono" inputMode="decimal" value={maxStake} onChange={(e) => setMaxStake(e.target.value)} />
                  <span className="shrink-0 text-[13px] text-muted">USDC</span>
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
        {st.can.solana ? (
          <div className={side(solOn)}>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="grid gap-0.5">
                <span className="text-[14px] text-cream">Solana trades</span>
                <span className="text-[12px] text-muted">Same token, same exits</span>
              </span>
              <input type="checkbox" role="switch" className="switch" checked={solOn} onChange={(e) => setSolOn(e.target.checked)} />
            </label>
            {solOn ? (
              <label className="grid gap-1.5">
                <span className="text-[12px] text-muted">Most per trade</span>
                <span className="flex items-center gap-2">
                  <input className="input font-mono" inputMode="decimal" value={maxTrade} onChange={(e) => setMaxTrade(e.target.value)} />
                  <span className="shrink-0 text-[13px] text-muted">SOL</span>
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      {st.can.solana ? <details className="rounded-xl bg-cream/[0.04] p-4" open>
        <summary className="cursor-pointer text-[14px] text-cream">Your shared Solana copy limits</summary>
        <p className="text-[12px] leading-relaxed text-muted">These settings apply across every agent you copy. Exposure uses recorded token cost; pending buys reserve the executor's full spend ceiling, including fee headroom. Loss limits use realized copy PnL recorded after this update; they do not cap unrealized losses. Exits continue when new entries stop.</p>
        <div className="grid gap-3 sm:grid-cols-2">{([
          ["maxTokenLamports", "Most in one token · SOL"], ["maxTotalLamports", "Most total open cost · SOL"],
          ["dailyLossLamports", "Daily realized loss · SOL"], ["maxDrawdownLamports", "Realized PnL drawdown · SOL"],
        ] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-[12px] text-muted">{label}<input className="input font-mono" type="number" min="0" step="0.01" value={Number(risk[key]) / 1e9} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n <= 10000) setRisk((p) => ({ ...p, [key]: String(Math.round(n * 1e9)) })); }} /></label>)}
          <label className="grid gap-1 text-[12px] text-muted">Maximum price deviation · %<input className="input" type="number" min="0.1" max="10" step="0.1" value={risk.maxPriceDriftBps / 100} onChange={(e) => setRisk((p) => ({ ...p, maxPriceDriftBps: Math.round(Number(e.target.value) * 100) }))} /></label>
          <label className="grid gap-1 text-[12px] text-muted">Maximum share of pool liquidity · %<input className="input" type="number" min="0.01" max="1" step="0.01" value={risk.maxLiquidityBps / 100} onChange={(e) => setRisk((p) => ({ ...p, maxLiquidityBps: Math.round(Number(e.target.value) * 100) }))} /></label>
        </div><p className="mb-0 text-[12px] text-muted">Zero disables an amount limit. Signals expire after two minutes. Missing price or liquidity skips a new copy. These checks cannot guarantee an execution price.</p>
      </details> : null}

      {sub?.solana ? <div className="grid gap-1 text-[13px] text-muted"><span>Your recorded realized copy PnL · 30d: <strong className="font-mono text-cream">{(Number(sub.realizedPnl) / 1e9).toFixed(4)} SOL</strong>{sub.receiptsLimited ? " · latest 1,000 exits" : ""}</span>
        {performance?.unit === "SOL" ? <span>Agent realized trading PnL · 30d: {(Number(tradingPerformance(performance.trades, performance.positions, Date.now()).periods[1].pnl) / 1e9).toFixed(4)} SOL. Different capital, start dates and fills; these totals are not like-for-like returns.</span> : null}
      </div> : null}

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={busy || (!arcOn && !solOn)} className="btn-primary !min-h-[44px] !w-auto !px-6 !py-2 !text-[15px]" onClick={() => void save(true)}>
          {sub?.active ? "Save changes" : "Start copying"}
        </button>
        {sub?.active ? (
          <button type="button" disabled={busy} className="text-[14px] text-coral hover:underline" onClick={() => void save(false)}>
            Stop copying
          </button>
        ) : null}
      </div>

      {sub && (sub.arc || sub.solana) ? (
        <div className="grid gap-3 border-t border-cream/10 pt-5">
          <h3 className="m-0 text-[15px] text-cream">Your copy wallets</h3>
          <div className={`grid gap-3 ${sub.arc && sub.solana ? "sm:grid-cols-2" : ""}`}>
            {sub.arc ? (
              <CopyWallet title="Arc copy wallet" hint="Send USDC on Arc" address={sub.arc.address} balance={`${sub.arc.balanceUsdc?.toFixed(2) ?? "?"} USDC`} href={arcExplorerUrl("address", sub.arc.address)} />
            ) : null}
            {sub.solana ? (
              <CopyWallet title="Solana copy wallet" hint="Send SOL" address={sub.solana.address} balance={`${sub.solana.spendableSol?.toFixed(3) ?? "?"} SOL free`} href={solscan("account", sub.solana.address)} />
            ) : null}
          </div>
          {sub.holdings.length ? (
            <p className="m-0 flex flex-wrap items-center gap-3 text-[13px] text-muted">
              Holding {sub.holdings.length} copied token{sub.holdings.length > 1 ? "s" : ""}; they exit with the agent.
              <button type="button" disabled={busy} className="text-coral hover:underline" onClick={() => void drain()}>
                Sell them now
              </button>
            </p>
          ) : null}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(wd.amount);
              if (!(n > 0)) return setNote("Enter an amount.");
              void act(async () => {
                const r = await signedPost<{ tx: string }>(`/api/launch/${slug}/copy/withdraw`, { owner, signMessage, action: "copy-withdraw", agent: slug, body: { chain: wd.chain, amount: n } });
                setWd({ ...wd, amount: "" });
                return `Sent to you (${r.tx.slice(0, 10)}…).`;
              });
            }}
          >
            <span className="text-[13px] text-muted">Withdraw</span>
            <select className="input !w-auto" value={wd.chain} onChange={(e) => setWd({ ...wd, chain: e.target.value as "arc" | "solana" })} aria-label="Withdraw from">
              {sub.arc ? <option value="arc">USDC (Arc)</option> : null}
              {sub.solana ? <option value="solana">SOL (Solana)</option> : null}
            </select>
            <input className="input !w-28 font-mono" inputMode="decimal" placeholder="0.00" value={wd.amount} onChange={(e) => setWd({ ...wd, amount: e.target.value })} aria-label="Amount" />
            <button type="submit" disabled={busy} className="rounded-full bg-cream/[0.08] px-4 py-2 text-[14px] text-cream hover:bg-cream/15">
              Withdraw
            </button>
          </form>
        </div>
      ) : null}
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}

function CopyWallet({ title, hint, address, balance, href }: { title: string; hint: string; address: string; balance: string; href: string }) {
  return (
    <div className="grid gap-2 rounded-xl bg-ink-deep/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-cream">{title}</span>
        <span className="font-mono text-[13px] tabular-nums text-cream">{balance}</span>
      </div>
      <p className="m-0 break-all font-mono text-[12px] leading-relaxed text-muted">{address}</p>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="text-dim">{hint}</span>
        <span className="flex items-center gap-3">
          <button type="button" className="text-cream hover:text-coral" onClick={() => void navigator.clipboard?.writeText(address)}>
            Copy
          </button>
          <a href={href} target="_blank" rel="noreferrer" className="text-coral hover:underline">
            Explorer <ExternalMark />
          </a>
        </span>
      </div>
    </div>
  );
}
