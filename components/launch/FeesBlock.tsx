"use client";

/**
 * "Where its fees go" on a launched agent's page (public: convex/launchFeeDb.ts feesView): the split in force, a
 * pending change with when it applies, and what its creator fees did so far. The owner can change the split here
 * (signed; it applies 24 hours later).
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import { useWallet } from "@solana/wallet-adapter-react";

import { api } from "@/convex/_generated/api";
import { signedPost } from "@/lib/launch/client";
import { changeText, perSol, sumsTo100, type Allocation } from "@/lib/launch/fees-view";
import FeeAllocator, { AllocationBar } from "./FeeAllocator";

const sol = (l: string) => (Number(BigInt(l)) / 1e9).toFixed(3);
const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default function FeesBlock({ slug, ticker, owner }: { slug: string; ticker: string; owner: string }) {
  const fees = useQuery(api.launchFeeDb.feesView, { slug });
  const { publicKey, signMessage } = useWallet();
  const [draft, setDraft] = useState<Allocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!fees) return null;
  const mine = !!publicKey && publicKey.toBase58() === owner && !!signMessage;

  const save = async () => {
    if (!draft || !publicKey || !signMessage) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await signedPost<{ effectiveAt: number | null }>(`/api/launch/${slug}/allocation`, { owner, signMessage, action: "allocation", agent: slug, body: { allocation: draft } });
      setNote(r.effectiveAt ? `Saved. It applies ${when(r.effectiveAt)}.` : "That is the split already in force.");
      setDraft(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5">
      <h2 className="m-0 font-display text-[1.4rem] text-cream">Where its fees go</h2>
      <p className="m-0 text-[14px] text-muted">
        Every trade of <span className="font-mono text-cream">${ticker}</span> on pump.fun pays creator fees to the agent: 10% platform, 10% AI costs, the rest split by its owner.
      </p>
      <AllocationBar allocation={fees.allocation} className="h-3.5" />
      <p className="m-0 font-mono text-[12px] leading-5 text-muted">{perSol(fees.allocation)} per 1 SOL</p>
      {fees.pending ? (
        <p className="m-0 text-[13px] text-cream">
          Changing: {changeText(fees.allocation, fees.pending.allocation)}, from {when(fees.pending.effectiveAt)}.
        </p>
      ) : null}
      <dl className="kv">
        <dt>Fees claimed</dt>
        <dd>{sol(fees.claimedLamports)} SOL</dd>
        <dt>To gas &amp; bankroll</dt>
        <dd>{sol(fees.toBankrollLamports)} SOL</dd>
        <dt>Bought back &amp; burned</dt>
        <dd>{sol(fees.burnedLamports)} SOL</dd>
        <dt>Airdropped to holders</dt>
        <dd>{sol(fees.airdroppedLamports)} SOL</dd>
      </dl>
      {mine ? (
        draft ? (
          <div className="grid gap-4 border-t border-cream/10 pt-4">
            <FeeAllocator value={draft} onChange={setDraft} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy || !sumsTo100(draft)} className="btn-primary !w-auto !px-5" onClick={() => void save()}>
                Save (applies in 24 h)
              </button>
              <button type="button" className="text-[14px] text-muted hover:text-cream" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="justify-self-start text-[14px] text-coral hover:underline" onClick={() => setDraft(fees.pending?.allocation ?? fees.allocation)}>
            Change the split
          </button>
        )
      ) : null}
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}
