"use client";

/**
 * The stake box on an Arc market. VS: challenge the creator (you take side B),
 * shown as "risk X, win at most Y" since every later challenger shrinks your
 * share. Pool: pick a side, shown as what it would return if it closed now.
 */
import { useState } from "react";

import { Link } from "@/i18n/navigation";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import { MIN_STAKE_WEI, parseUsdc, poolQuote, stakeCall, vsChallengeQuote, vsRoom } from "@/lib/arc/markets";
import AccountGate from "./AccountGate";
import { BTN_PRIMARY, usd, type ArcMarket } from "./shared";
import type { useArcAccount } from "./useArcAccount";
import { useArcSend } from "./useArcSend";

export default function ArcStakePanel({
  m,
  mine,
  account,
}: {
  m: ArcMarket;
  mine: { side: number; amount: string }[];
  account: ReturnType<typeof useArcAccount>;
}) {
  const { send, busy, error, last } = useArcSend(account.session);
  const [amount, setAmount] = useState("2");
  const [side, setSide] = useState<1 | 2>(m.kind === "vs" ? 2 : 1);

  const contract = m.kind === "vs" ? ARC.contracts.mimirV3 : ARC.contracts.mimirPool;
  const stake = parseUsdc(amount);
  const a = BigInt(m.stakeA);
  const b = BigInt(m.stakeB);
  const isCreator = account.address?.toLowerCase() === m.creator;
  const room = m.kind === "vs" ? vsRoom(a, b) : null;
  const quote =
    stake === null
      ? null
      : m.kind === "vs"
        ? vsChallengeQuote(a, b, stake, m.feeBps)
        : side === 1
          ? poolQuote(a, b, stake, m.feeBps)
          : poolQuote(b, a, stake, m.feeBps);

  let blocker: string | null = null;
  if (m.kind === "vs" && isCreator) blocker = "You created this market: challengers take the other side.";
  else if (m.kind === "vs" && mine.some((p) => p.side === 2)) blocker = "You already challenged this market.";
  else if (room === 0n) blocker = "This market is full: challengers can stake at most 5× the creator's stake.";
  else if (stake === null) blocker = "Enter an amount in USDC.";
  else if (stake < MIN_STAKE_WEI) blocker = "The minimum stake is $2.";
  else if (room !== null && stake > room) blocker = `At most ${usd(room)} more fits in this market.`;
  else if (account.balance !== null && stake > account.balance) blocker = "not-enough";

  const onStake = async () => {
    if (!contract || stake === null || blocker) return;
    if (await send([stakeCall(contract, m.kind, m.marketId, stake, side)])) void account.reload();
  };

  return (
    <div className="grid gap-4">
      <h2 className="m-0 font-display text-[1.4rem] leading-none text-cream">{m.kind === "vs" ? "Challenge" : "Take a side"}</h2>
      <AccountGate account={account}>
        {m.kind === "pool" ? (
          <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-2">
            {([1, 2] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={side === s}
                onClick={() => setSide(s)}
                className={`truncate rounded-xl px-3 py-2.5 text-[14px] ${side === s ? "bg-panel-raised text-cream shadow-[inset_0_0_0_1px_rgb(255_81_72/.6)]" : "bg-panel text-muted"}`}
              >
                {s === 1 ? m.labelA : m.labelB}
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[14px] text-muted">
            You back <span className="text-coral">{m.labelB}</span> against the creator&apos;s {usd(a)}.
          </p>
        )}

        <label className="grid gap-1.5 text-[13px] text-muted">
          Stake (USDC)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-xl bg-ink-deep px-4 py-3 font-mono text-[16px] text-cream outline-none focus-visible:shadow-[inset_0_0_0_1px_rgb(255_81_72/.7)]"
          />
        </label>

        {quote ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-panel p-3.5 text-[13px]">
            <span className="text-muted">You risk</span>
            <span className="text-right text-cream">{usd(quote.risk)}</span>
            <span className="text-muted">{quote.atMost ? "You win at most" : "Returns if it closed now"}</span>
            <span className="text-right text-win">{usd(quote.win)}</span>
          </div>
        ) : null}

        <p className="m-0 text-[12px] text-dim">
          Arc balance: {account.balance === null ? "-" : usd(account.balance)}
          {m.feeBps ? ` · ${m.feeBps / 100}% fee on profit only` : ""}
        </p>

        {blocker === "not-enough" ? (
          <Link href="/wallet" className={`${BTN_PRIMARY} text-center`}>
            Add USDC from Solana
          </Link>
        ) : (
          <>
            {blocker ? <p className="m-0 text-[13px] text-pending">{blocker}</p> : null}
            <button className={BTN_PRIMARY} disabled={busy || Boolean(blocker) || !contract} onClick={() => void onStake()}>
              {busy ? "Confirm with your passkey…" : m.kind === "vs" ? `Challenge with ${stake ? usd(stake) : "-"}` : `Stake ${stake ? usd(stake) : "-"}`}
            </button>
          </>
        )}
        {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
        {last ? (
          <a href={arcExplorerUrl("tx", last.txHash)} target="_blank" rel="noreferrer" className="text-[13px] text-coral hover:underline">
            ✓ Staked, view on ArcScan
          </a>
        ) : null}
      </AccountGate>
    </div>
  );
}
