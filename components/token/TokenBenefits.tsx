"use client";
import { useEffect, useState } from "react";
import { holderProofHeaders, useHolderTier } from "./useHolderTier";
import { previewBenefits } from "@/lib/token-benefits";
type Benefits = { tier: string; benefits: { chartPoints: number; aiCallsPerAgentDay: number }; entryBps: number; usage: { month: string; arc: string | null; limited: boolean; entryFees: { entries: number; saved: string; paid: string }; preview: { tier: "none" | "holder" | "backer" | "oracle-circle"; aiCallsToday: number; agents: number; expiresAt: number | null } } };
export default function TokenBenefits() {
  const { wallet, proven, prove } = useHolderTier();
  const [data, setData] = useState<Benefits | null>(null), [error, setError] = useState("");
  useEffect(() => { setData(null); setError(""); if (!wallet || !proven) return; let active = true;
    void fetch("/api/token/benefits", { headers: holderProofHeaders(wallet) }).then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (active) setData(body); }).catch((e) => { if (active) setError(e.message); }); return () => { active = false; };
  }, [wallet, proven]);
  return <section className="grid gap-3 rounded-2xl bg-cream/[0.04] p-5"><h2 className="m-0 font-display text-[1.6rem] text-cream">Your $MIMIR usage benefits</h2>
    <p className="m-0 max-w-[80ch] text-[13px] text-muted">$MIMIR unlocks product access and quotas. Each agent's own token has its separate creator-fee allocation. Holding either token does not represent the other token's revenue.</p>
    {!wallet ? <p className="text-[13px] text-muted">Connect your Solana wallet to see your usage.</p> : !proven ? <button className="justify-self-start text-coral" onClick={() => void prove().catch(() => setError("Wallet verification was declined."))}>Verify wallet to view benefits</button> : null}
    {error ? <p role="alert" className="text-[12px] text-coral">{error}</p> : null}
    {data ? <><dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-3">{[
      ["Current MIMIR tier", data.tier], ["Entry fee eligibility", `${data.entryBps / 100}% · requires a valid fee ticket`],
      [`Verified pool entry savings · ${data.usage.month}`, `${(Number(data.usage.entryFees.saved) / 1e18).toFixed(4)} USDC`],
      ["Verified pool entries", String(data.usage.entryFees.entries)], ["Preview agents", `${data.usage.preview.agents} / 3`], ["Preview AI calls today", String(data.usage.preview.aiCallsToday)],
    ].map(([label, value]) => <div key={label}><dt className="text-[12px] text-muted">{label}</dt><dd className="m-0 text-[14px] text-cream">{value}</dd></div>)}</dl>
      <p className="m-0 text-[12px] text-muted">New sessions at your current tier: up to {data.benefits.aiCallsPerAgentDay} AI calls per agent per UTC day and {data.benefits.chartPoints} observed chart points per token. Your current session was assigned {data.usage.preview.tier}: {previewBenefits(data.usage.preview.tier).aiCallsPerAgentDay} calls/day. Global hourly/daily ceilings still apply; these are caps, not guaranteed capacity.</p>
      <p className="m-0 text-[12px] text-muted">Savings compare verified indexed pool entry fees with a 0.5% baseline. VS entries, gas, copy profit fees and entries without complete fee evidence are excluded.{!data.usage.arc ? " Link an Arc account to measure fees." : ""}{data.usage.limited ? " History is capped; totals may be incomplete." : ""}</p>
    </> : null}
  </section>;
}
