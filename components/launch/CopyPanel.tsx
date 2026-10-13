"use client";

/**
 * Copy an agent from its page: pick its Arc market stakes, its Solana trades or both, set a cap per copy, fund the
 * copy wallets, stop, withdraw. Copying needs $MIMIR (the server checks); every change is signed by the wallet.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import Chip from "@/components/ui/Chip";
import { signedPost } from "@/lib/launch/client";
import { solscan } from "@/lib/launch/council-view";
import { arcExplorerUrl } from "@/lib/arc/config";
import { ExternalMark } from "@/components/ExternalMark";

type Status = {
  can: { solana: boolean; arc: boolean };
  sub: null | {
    active: boolean;
    pausedReason: string | null;
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

  const load = useCallback(async () => {
    if (!owner) return;
    const res = await fetch(`/api/launch/${slug}/copy?follower=${owner}`).catch(() => null);
    if (!res?.ok) return;
    const s = (await res.json()) as Status;
    setSt(s);
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
        ...(st.can.arc ? { arc: { on: arcOn, maxPerStakeUsdc: Number(maxStake) || 0.1 } } : {}),
        ...(st.can.solana ? { solana: { on: solOn, maxPerTradeSol: Number(maxTrade) || 0.01 } } : {}),
      };
      await signedPost(`/api/launch/${slug}/copy`, { owner, signMessage, action: "copy", agent: slug, body });
      return active ? "Copying. Fund the copy wallets below." : "Stopped: no new copies. What you hold still exits with the agent.";
    });
  const sub = st.sub;

  return (
    <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5">
      <div className="grid gap-1">
        <h2 className="m-0 font-display text-[1.4rem] text-cream">Copy ${ticker}</h2>
        <p className="m-0 text-[13px] text-muted">Its moves, from wallets of your own. Needs $MIMIR. You can stop and withdraw any time.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to copy">
        {st.can.arc ? <Chip active={arcOn} onClick={() => setArcOn(!arcOn)}>Market stakes (Arc)</Chip> : null}
        {st.can.solana ? <Chip active={solOn} onClick={() => setSolOn(!solOn)}>Solana trades</Chip> : null}
      </div>
      <div className="flex flex-wrap gap-4">
        {st.can.arc && arcOn ? (
          <label className="grid gap-1.5">
            <span className="text-[13px] text-muted">Most per stake (USDC)</span>
            <input className="input !w-32 font-mono" inputMode="decimal" value={maxStake} onChange={(e) => setMaxStake(e.target.value)} />
          </label>
        ) : null}
        {st.can.solana && solOn ? (
          <label className="grid gap-1.5">
            <span className="text-[13px] text-muted">Most per trade (SOL)</span>
            <input className="input !w-32 font-mono" inputMode="decimal" value={maxTrade} onChange={(e) => setMaxTrade(e.target.value)} />
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || (!arcOn && !solOn)} className="btn-primary !w-auto !px-5" onClick={() => void save(true)}>
          {sub?.active ? "Save" : "Start copying"}
        </button>
        {sub?.active ? (
          <button type="button" disabled={busy} className="text-[14px] text-coral hover:underline" onClick={() => void save(false)}>
            Stop
          </button>
        ) : null}
        {sub && !sub.active && sub.pausedReason ? <span className="text-[13px] text-coral">Paused: {sub.pausedReason}</span> : null}
      </div>

      {sub && (sub.arc || sub.solana) ? (
        <div className="grid gap-2 border-t border-cream/10 pt-4 font-mono text-[12px] text-muted">
          {sub.arc ? (
            <a href={arcExplorerUrl("address", sub.arc.address)} target="_blank" rel="noreferrer" className="hover:text-coral">
              <span className="mr-2 text-dim">Arc copy wallet · send USDC on Arc</span>
              {sub.arc.address} · {sub.arc.balanceUsdc?.toFixed(2) ?? "?"} USDC <ExternalMark />
            </a>
          ) : null}
          {sub.solana ? (
            <a href={solscan("account", sub.solana.address)} target="_blank" rel="noreferrer" className="hover:text-coral">
              <span className="mr-2 text-dim">Solana copy wallet · send SOL</span>
              {sub.solana.address} · {sub.solana.spendableSol?.toFixed(3) ?? "?"} SOL free <ExternalMark />
            </a>
          ) : null}
          {sub.holdings.length ? (
            <span className="flex flex-wrap items-center gap-3">
              Holding {sub.holdings.length} copied token{sub.holdings.length > 1 ? "s" : ""}; they exit with the agent.
              <button
                type="button"
                disabled={busy}
                className="font-sans text-coral hover:underline"
                onClick={() =>
                  void act(async () => {
                    await signedPost(`/api/launch/${slug}/copy/drain`, { owner, signMessage, action: "copy-drain", agent: slug, body: {} });
                    return "Selling your copied tokens now. Their SOL is free to withdraw in a minute.";
                  })
                }
              >
                Sell them now
              </button>
            </span>
          ) : null}
          <form
            className="mt-1 flex flex-wrap items-end gap-3 font-sans"
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
            <select className="input !w-auto" value={wd.chain} onChange={(e) => setWd({ ...wd, chain: e.target.value as "arc" | "solana" })} aria-label="Withdraw from">
              {sub.arc ? <option value="arc">USDC (Arc)</option> : null}
              {sub.solana ? <option value="solana">SOL (Solana)</option> : null}
            </select>
            <input className="input !w-28 font-mono" inputMode="decimal" placeholder="0.00" value={wd.amount} onChange={(e) => setWd({ ...wd, amount: e.target.value })} aria-label="Amount" />
            <button type="submit" disabled={busy} className="btn-ghost !w-auto !px-4">Withdraw</button>
          </form>
        </div>
      ) : null}
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}
