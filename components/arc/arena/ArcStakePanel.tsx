"use client";

/**
 * The stake box on a market (Base or Arc: the account is on the market's chain). VS: challenge the creator (you take side B),
 * shown as "risk X, win at most Y" since every later challenger shrinks your
 * share. Pool: pick a side, shown as what it would return if it closed now.
 */
import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";
import { betCardUrl, betIntentUrl } from "@/lib/bet-share";

import { Link } from "@/i18n/navigation";
import { maxGrossFor, parseUsdc, poolQuote, readStakeLimits, stakeLimitBlocker, vsChallengeQuote, vsRoom, type StakeLimits } from "@/lib/arc/markets";
import { floorToChain, toIndexUnits } from "@/lib/chains/amounts";
import { chainPublicClient } from "@/lib/chains/client";
import { explorerUrl, marketContract } from "@/lib/chains/registry";
import AccountGate from "./AccountGate";
import { BTN_PRIMARY, usd, usdFine, type ArcMarket } from "./shared";
import type { useArcAccount } from "./useArcAccount";
import { useArcSend } from "./useArcSend";

export default function ArcStakePanel({
  m,
  mine,
  account,
  inSheet = false,
}: {
  m: ArcMarket;
  mine: { side: number; amount: string }[];
  account: ReturnType<typeof useArcAccount>;
  /** In the phone's bottom sheet, whose own title already says what this is. */
  inSheet?: boolean;
}) {
  const { send, busy, error, last } = useArcSend(account);
  const cfg = account.chainConfig;
  const MIN_STAKE_WEI = cfg.contracts.minStakeWei;
  const [amount, setAmount] = useState("1");
  const [side, setSide] = useState<1 | 2>(m.kind === "vs" ? 2 : 1);
  // After a stake goes through: the share sheet (lib/bet-share.ts), with the side and amount just staked.
  const [shared, setShared] = useState<{ side: 1 | 2; amount: string } | null>(null);

  const contract = marketContract(cfg, m.kind);
  // Launch caps, the early lock and the pause, read live from the contract (the index can lag a block or two).
  const [limits, setLimits] = useState<StakeLimits | null>(null);
  useEffect(() => {
    if (!contract) return;
    let live = true;
    // The contract's caps are in its own units (6 dp on Base): scale them to index units like everything else here.
    readStakeLimits(chainPublicClient(cfg), contract, m.marketId).then(
      (l) => live && setLimits({ ...l, maxMarket: toIndexUnits(cfg, l.maxMarket), maxAccount: toIndexUnits(cfg, l.maxAccount) }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [contract, m.marketId, last, cfg]);
  const stake = parseUsdc(amount);
  const a = BigInt(m.stakeA);
  const b = BigInt(m.stakeB);
  const isCreator = account.address?.toLowerCase() === m.creator;
  const bps = account.entryBps;
  // The 5x cap counts net stakes; what you may send is a little more, the fee on top.
  const room = m.kind === "vs" ? floorToChain(cfg, maxGrossFor(vsRoom(a, b), bps)) : null;
  const quote =
    stake === null
      ? null
      : m.kind === "vs"
        ? vsChallengeQuote(a, b, stake, bps)
        : side === 1
          ? poolQuote(a, b, stake, bps)
          : poolQuote(b, a, stake, bps);

  let blocker: string | null = null;
  if (m.kind === "vs" && isCreator) blocker = "You created this market: challengers take the other side.";
  else if (m.kind === "vs" && mine.some((p) => p.side === 2)) blocker = "You already challenged this market.";
  else if (room === 0n) blocker = "This market is full: challengers can stake at most 5× the creator's stake.";
  else if (stake === null) blocker = "Enter an amount in USDC.";
  else if (stake < MIN_STAKE_WEI) blocker = `The minimum stake is ${usd(MIN_STAKE_WEI)}.`;
  else if (room !== null && stake > room) blocker = `At most ${usd(room)} more fits in this market.`;
  else if (limits) {
    const mineNet = mine.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    const now = Math.floor(Date.now() / 1000);
    blocker = stakeLimitBlocker(limits, { kind: m.kind, gross: stake, entryBps: bps, mine: mineNet, total: a + b, now }, usd);
  }
  if (!blocker && account.balance !== null && stake !== null && stake > account.balance) blocker = "not-enough";
  if (!blocker && cfg.gas.symbol === "ETH" && account.gas === 0n) blocker = `Your wallet needs a little ETH on ${cfg.label} for gas.`;

  const onStake = async () => {
    if (!contract || stake === null || blocker) return;
    if (await send({ type: "stake", kind: m.kind, marketId: m.marketId, stake, side: m.kind === "vs" ? 2 : side })) {
      void account.reload();
      setShared({ side, amount: usd(stake) });
    }
  };

  return (
    <div className="grid gap-4">
      {inSheet ? null : <h2 className="m-0 font-display text-[1.4rem] leading-none text-cream">{m.kind === "vs" ? "Challenge" : "Take a side"}</h2>}
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
            <span className="text-muted">
              Fee {bps / 100}%
            </span>
            <span className="text-right text-cream">{usdFine(quote.fee)}</span>
            <span className="text-muted">{quote.atMost ? "You win at most" : "Returns if it closed now"}</span>
            <span className="text-right text-win">{usd(quote.win)}</span>
          </div>
        ) : null}

        <p className="m-0 text-[12px] text-dim">
          {cfg.gas.symbol === "ETH"
            ? `USDC on ${cfg.label}: ${account.balance === null ? "-" : usd(account.balance)} · gas in ETH${account.gas === null ? "" : ` (${(Number(account.gas) / 1e18).toFixed(5)} ETH)`}`
            : `USDC on ${cfg.label}: ${account.balance === null ? "-" : usd(account.balance)} · gas is paid in USDC`}
        </p>

        {blocker === "not-enough" ? (
          <Link href="/wallet" className={`${BTN_PRIMARY} text-center`}>
            Add USDC
          </Link>
        ) : (
          <>
            {blocker ? <p className="m-0 text-[13px] text-pending">{blocker}</p> : null}
            <button className={BTN_PRIMARY} disabled={busy || Boolean(blocker) || !contract} onClick={() => void onStake()}>
              {busy ? (cfg.usdc.kind === "erc20" ? "Confirm in your wallet (approve or sign, then stake)…" : "Confirm in your wallet…") : m.kind === "vs" ? `Challenge with ${stake ? usd(stake) : "-"}` : `Stake ${stake ? usd(stake) : "-"}`}
            </button>
          </>
        )}
        {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
        {last ? (
          <a href={explorerUrl(cfg, "tx", last.txHash)} target="_blank" rel="noreferrer" className="text-[13px] text-coral hover:underline">
            ✓ Staked, view on {cfg.explorerName}
          </a>
        ) : null}
      </AccountGate>
      {shared ? (
        <Modal open onClose={() => setShared(null)} title="You're in" variant="sheet">
          <div className="mt-4 grid gap-4">
            <p className="m-0 text-[14px] leading-relaxed text-muted">
              {shared.amount} on <span className="text-cream">&ldquo;{shared.side === 1 ? m.labelA : m.labelB}&rdquo;</span>. Tell people, and let them take the other side.
            </p>
            {/* The card X will show under the post. */}
            <img
              src={betCardUrl(m.kind, m.marketId, shared.side, undefined, account.chain)}
              alt=""
              width={1200}
              height={630}
              className="aspect-[1200/630] w-full rounded-xl bg-ink-deep object-cover"
            />
            <div className="flex flex-wrap gap-3">
              <a
                href={betIntentUrl(m.kind, m.marketId, shared.side, m.question, shared.side === 1 ? m.labelA : m.labelB, shared.amount, undefined, account.chain)}
                target="_blank"
                rel="noreferrer"
                className={`${BTN_PRIMARY} flex-1 text-center`}
              >
                Share on X
              </a>
              <button type="button" onClick={() => setShared(null)} className="rounded-full bg-cream/[0.07] px-5 py-2.5 text-[14px] text-cream">
                Done
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
