"use client";

/**
 * The two things a participant can do outside staking:
 *   cancel   the VS creator, while nobody has challenged yet: the stake comes back (the entry fee stays earned)
 *   dispute  any participant, while the oracle's proposal is inside its dispute window: a 2 USDC bond escalates it
 *            to the arbiter; the bond comes back if the verdict changes, and is forfeited if it stands
 */
import { useState } from "react";

import { DISPUTE_BOND_WEI } from "@/lib/chains/calls";
import { explorerUrl, marketContract } from "@/lib/chains/registry";
import { BTN_SECONDARY, usd, type ArcMarket } from "./shared";
import type { useArcAccount } from "./useArcAccount";
import { useArcSend } from "./useArcSend";

const BOND = DISPUTE_BOND_WEI;

export default function ArcMarketActions({
  m,
  mine,
  account,
  now,
}: {
  m: ArcMarket;
  mine: { side: number }[];
  account: ReturnType<typeof useArcAccount>;
  now: number;
}) {
  const { send, busy, error, last } = useArcSend(account);
  const cfg = account.chainConfig;
  const [confirming, setConfirming] = useState(false);
  const me = account.address;
  const canCancel = m.kind === "vs" && m.status === "open" && me === m.creator;
  const canDispute = m.status === "proposed" && m.disputableUntil > now && mine.length > 0;
  if (!account.session || (!canCancel && !canDispute)) return null;

  const contract = marketContract(cfg, m.kind);
  const short = account.balance !== null && account.balance < BOND;

  const cancel = async () => {
    if (!contract) return;
    if (await send({ type: "cancel", marketId: m.marketId })) void account.reload();
  };
  const dispute = async () => {
    if (!contract) return;
    if (await send({ type: "dispute", kind: m.kind, marketId: m.marketId })) void account.reload();
  };

  return (
    <div className="mt-6 grid gap-3 border-t border-line pt-5">
      {canCancel ? (
        <>
          <p className="m-0 text-[13px] leading-relaxed text-muted">Nobody has challenged yet. You can cancel and take your stake back.</p>
          <button type="button" disabled={busy} onClick={() => void cancel()} className={BTN_SECONDARY}>
            {busy ? "Confirm in your wallet…" : "Cancel and get your stake back"}
          </button>
        </>
      ) : null}
      {canDispute ? (
        <>
          <p className="m-0 text-[13px] leading-relaxed text-muted">
            Think the oracle got it wrong? Dispute with a {usd(BOND)} bond before the window closes: it comes back if the arbiter changes the result, and
            is kept if the result stands.
          </p>
          {confirming ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || short} onClick={() => void dispute()} className="rounded-full bg-danger px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60">
                {busy ? "Confirm in your wallet…" : `Dispute (${usd(BOND)} bond)`}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={BTN_SECONDARY}>
                Keep the result
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={BTN_SECONDARY}>
              Dispute the result
            </button>
          )}
          {short ? <p className="m-0 text-[12px] text-pending">You need {usd(BOND)} USDC on {cfg.label} for the bond.</p> : null}
        </>
      ) : null}
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
      {last ? (
        <a href={explorerUrl(cfg, "tx", last.txHash, last.layer)} target="_blank" rel="noreferrer" className="text-[13px] text-coral hover:underline">
          ✓ Done, view on {cfg.explorerName}
        </a>
      ) : null}
    </div>
  );
}
