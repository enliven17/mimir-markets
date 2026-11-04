"use client";

/**
 * Copy an agent's market stakes from its page: set a cap per stake, fund the copy wallets (one per enabled chain:
 * copies follow the leader's chain; Base also needs a little ETH for gas), stop, withdraw. Every change is signed by
 * the wallet.
 */
import { useCallback, useEffect, useState } from "react";
import { useMimirWallet } from "@/hooks/useMimirWallet";

import { signedPost } from "@/lib/launch/client";
import { explorerUrl, MARKET_CHAINS, type MarketChainId } from "@/lib/chains/registry";
import { ExternalMark } from "@/components/ExternalMark";
import { trackProductEvent } from "@/lib/product-analytics";

type Status = {
  can: boolean;
  sub: null | {
    active: boolean;
    pausedReason: string | null;
    solana?: null | { address: string; on: boolean; maxPerStakeUsdc: number; balanceUsdc: number | null; balanceSol: number | null };
    arc: null | { address: string; on: boolean; maxPerStakeUsdc: number; balanceUsdc: number | null };
    base?: null | { address: string; on: boolean; maxPerStakeUsdc: number; balanceUsdc: number | null; balanceEth: number | null };
  };
};

const ENABLED = MARKET_CHAINS.enabled;

export default function CopyPanel({ slug, ticker }: { slug: string; ticker: string }) {
  const { address, signMessage } = useMimirWallet();
  const owner = address ?? null;
  const [st, setSt] = useState<Status | null>(null);
  const [maxStake, setMaxStake] = useState("2");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!owner) return;
    const res = await fetch(`/api/launch/${slug}/copy?follower=${owner}`).catch(() => null);
    if (!res?.ok) return;
    const s = (await res.json()) as Status;
    setSt(s);
    const w = s.sub?.solana;
    if (w) setMaxStake(String(w.maxPerStakeUsdc));
  }, [owner, slug]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!owner || !st?.sub?.active || !((st.sub.solana?.balanceUsdc ?? 0) > 0)) return;
    try { const key = `mimir.copy-funded:${owner}:${slug}`; if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); trackProductEvent("copy_funded", { mode: "live" }); } catch { /* Analytics never block copying. */ }
  }, [owner, slug, st]);

  if (!owner || !signMessage || !st || !st.can) return null;

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
      const cap = { on: active, maxPerStakeUsdc: Number(maxStake) || 2 };
      const body = { active, solana: cap };
      await signedPost(`/api/launch/${slug}/copy`, { owner, signMessage, action: "copy", agent: slug, body });
      if (active && !st.sub?.active) trackProductEvent("copy_started", { mode: "live" });
      return active ? "Copying. Fund your copy wallet below." : "Stopped: no new copies. Open stakes settle on their own.";
    });
  const sub = st.sub;

  return (
    <section className="grid gap-5 rounded-2xl bg-[rgb(27_19_20/.93)] p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 font-display text-[1.5rem] leading-none text-cream">Copy ${ticker}</h2>
          <p className="m-0 max-w-[60ch] text-[13px] text-muted">Its market stakes, from a wallet of your own on the same network ({ENABLED.map((c) => MARKET_CHAINS.chains[c].label).join(" and ")}), up to your cap. Same market, same side. Stop and withdraw any time.</p>
        </div>
        {sub ? (
          <span className={`rounded-full px-3 py-1 text-[12px] ${sub.active ? "bg-emerald-400/10 text-emerald-300" : "bg-cream/[0.06] text-muted"}`}>
            {sub.active ? "Copying" : sub.pausedReason ? `Paused: ${sub.pausedReason}` : "Stopped"}
          </span>
        ) : null}
      </div>

      <label className="grid max-w-xs gap-1.5">
        <span className="text-[12px] text-muted">Most per stake</span>
        <span className="flex items-center gap-2">
          <input className="input font-mono" inputMode="decimal" value={maxStake} onChange={(e) => setMaxStake(e.target.value)} />
          <span className="shrink-0 text-[13px] text-muted">USDC</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={busy} className="btn-primary !min-h-[44px] !w-auto !px-6 !py-2 !text-[15px]" onClick={() => void save(true)}>
          {sub?.active ? "Save changes" : "Start copying"}
        </button>
        {sub?.active ? (
          <button type="button" disabled={busy} className="text-[14px] text-coral hover:underline" onClick={() => void save(false)}>
            Stop copying
          </button>
        ) : null}
      </div>

      {(["solana"] as const).map((c) => {
        const w = sub?.solana;
        if (!w || !ENABLED.includes(c)) return null;
        return (
          <CopyWallet
            key={c}
            chain={c}
            wallet={w}
            busy={busy}
            onWithdraw={(n) =>
              act(async () => {
                const r = await signedPost<{ tx: string }>(`/api/launch/${slug}/copy/withdraw`, { owner, signMessage, action: "copy-withdraw", agent: slug, body: { amount: n, chain: c } });
                return `Sent to you (${r.tx.slice(0, 10)}…).`;
              })
            }
          />
        );
      })}
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}

/** One chain's copy wallet: its balance (and ETH for gas on Base), its address, and a withdrawal back to you. */
function CopyWallet({
  chain,
  wallet,
  busy,
  onWithdraw,
}: {
  chain: MarketChainId;
  wallet: { address: string; balanceUsdc: number | null; balanceEth?: number | null; balanceSol?: number | null };
  busy: boolean;
  onWithdraw: (n: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const cfg = MARKET_CHAINS.chains[chain];
  return (
    <div className="grid gap-3 border-t border-cream/10 pt-5">
      <h3 className="m-0 text-[15px] text-cream">Your copy wallet on {cfg.label}</h3>
      <div className="grid gap-2 rounded-xl bg-ink-deep/70 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-cream">On {cfg.label}</span>
          <span className="font-mono text-[13px] tabular-nums text-cream">
            {wallet.balanceUsdc?.toFixed(2) ?? "?"} USDC · {wallet.balanceSol?.toFixed(5) ?? "?"} devnet SOL
          </span>
        </div>
        <p className="m-0 break-all font-mono text-[12px] leading-relaxed text-muted">{wallet.address}</p>
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="text-dim">{cfg.gas.symbol === "ETH" ? `Send USDC and a little ETH (gas) on ${cfg.label}` : `Send test USDC and devnet SOL on ${cfg.label}`}</span>
          <span className="flex items-center gap-3">
            <button type="button" className="text-cream hover:text-coral" onClick={() => void navigator.clipboard?.writeText(wallet.address)}>
              Copy
            </button>
            <a href={explorerUrl(cfg, "address", wallet.address)} target="_blank" rel="noreferrer" className="text-coral hover:underline">
              Explorer <ExternalMark />
            </a>
          </span>
        </div>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amount);
          if (!(n > 0)) return;
          void onWithdraw(n).then(() => setAmount(""));
        }}
      >
        <span className="text-[13px] text-muted">Withdraw</span>
        <input className="input !w-28 font-mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Amount in USDC on ${cfg.label}`} />
        <span className="text-[13px] text-muted">USDC</span>
        <button type="submit" disabled={busy} className="rounded-full bg-cream/[0.08] px-4 py-2 text-[14px] text-cream hover:bg-cream/15">
          Withdraw
        </button>
      </form>
    </div>
  );
}
