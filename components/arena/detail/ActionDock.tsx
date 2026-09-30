"use client";

/**
 * The one thing the viewer can do on a claim right now, in one card:
 *   live       challenge (amount pill + primary button, rollup balance,
 *              "Manage balance"), or connect a wallet
 *   past deadline, PROPOSED, DISPUTED   the V3 dispute / finalize / refund controls
 *   RESOLVED   the payout cranks
 *   CANCELLED  a one-line note
 * The page pins it: sticky bottom on phones while a claim is live, a sticky
 * right-hand card on desktop.
 */
import { useId } from "react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/Button";
import DisputePanel from "@/components/arena/settlement/DisputePanel";
import PayoutPanel from "@/components/arena/settlement/PayoutPanel";
import type { ApiClaim } from "@/lib/server/arena-claim";
import type { BrowserMimir } from "@/lib/solana/browser-client";
import { claimPhase } from "@/lib/claim-status";
import { challengerGross, splitFees } from "@/lib/solana/fees";
import { MIN_STAKE } from "@/lib/constants";
import { formatUsdcUnits } from "@/lib/money";

export interface ChallengeState {
  stake: string;
  busy: string | null;
  log: string[];
  lastSig: string | null;
}

/** What a winning challenger staking `units` now would net, after the claim's frozen fees. */
function netIfWin(claim: ApiClaim, units: bigint): bigint | null {
  if (units <= 0n) return null;
  const leg = challengerGross(2, units, BigInt(claim.creatorStake), BigInt(claim.totalChallengerStake) + units);
  if (!leg) return null;
  return splitFees({
    gross: leg.gross,
    principal: leg.principal,
    policy: {
      platformFeeBps: claim.platformFeeBps,
      agentOwnerFeeBps: 0,
      platformRecipient: claim.platformFeeBps > 0 ? "platform" : null,
    },
    winner: "you",
  }).netPayout;
}

export default function ActionDock({
  claim,
  now,
  mimir,
  viewer,
  balance,
  challenge,
  onStake,
  onChallenge,
  onChanged,
  onManageBalance,
  onConnect,
}: {
  claim: ApiClaim;
  now: number;
  mimir: BrowserMimir | null;
  viewer: string | null;
  balance: bigint;
  challenge: ChallengeState;
  onStake: (v: string) => void;
  onChallenge: () => void;
  onChanged: () => void;
  onManageBalance: () => void;
  onConnect: () => void;
}) {
  const t = useTranslations("arena.detail.dock");
  const phase = claimPhase(claim.state, claim.deadline, now);

  let content: React.ReactNode;
  if (phase === "cancelled") {
    content = <p className="m-0 text-[14px] text-muted">{t("cancelled")}</p>;
  } else if (phase === "resolved") {
    content = <PayoutPanel claim={claim} mimir={mimir} viewer={viewer} onChanged={onChanged} />;
  } else if (phase === "proposed" || phase === "disputed") {
    content = <DisputePanel claim={claim} mimir={mimir} viewer={viewer} onChanged={onChanged} />;
  } else if (claim.deadline <= now) {
    content = (
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <p className="m-0 text-[15px] text-cream">{t("deadlinePassed")}</p>
          <p className="m-0 text-[13px] leading-relaxed text-muted">{t("deadlinePassedBody")}</p>
        </div>
        <DisputePanel claim={claim} mimir={mimir} viewer={viewer} onChanged={onChanged} />
      </div>
    );
  } else {
    content = (
      <ChallengeForm
        claim={claim}
        connected={!!mimir}
        balance={balance}
        challenge={challenge}
        onStake={onStake}
        onChallenge={onChallenge}
        onManageBalance={onManageBalance}
        onConnect={onConnect}
      />
    );
  }

  return (
    <div
      className="rounded-3xl bg-[rgb(22_14_15/.97)] p-5 shadow-modal ring-1 ring-inset ring-cream/[0.06] sm:p-6"
      data-testid="action-dock"
    >
      {content}
    </div>
  );
}

function ChallengeForm({
  claim,
  connected,
  balance,
  challenge,
  onStake,
  onChallenge,
  onManageBalance,
  onConnect,
}: {
  claim: ApiClaim;
  connected: boolean;
  balance: bigint;
  challenge: ChallengeState;
  onStake: (v: string) => void;
  onChallenge: () => void;
  onManageBalance: () => void;
  onConnect: () => void;
}) {
  const t = useTranslations("arena.detail.dock");
  const inputId = useId();
  const seats = claim.maxChallengers > 0 ? claim.maxChallengers : 1;
  const full = claim.challengers.length >= seats;
  const units = BigInt(Math.max(0, Math.round(Number(challenge.stake) * 1e6) || 0));
  const net = netIfWin(claim, units);
  const tooSmall = Number(challenge.stake) < MIN_STAKE;

  return (
    <div className="grid gap-3.5">
      <div className="grid gap-1">
        <p className="m-0 text-[15px] text-cream">{t("challengeTitle")}</p>
        <p className="m-0 truncate text-[13px] text-coral" title={claim.counterPosition}>
          {claim.counterPosition}
        </p>
      </div>

      {full ? (
        <p className="m-0 text-[14px] text-muted">{t("full")}</p>
      ) : !connected ? (
        <div className="grid gap-2">
          <Button size="sm" onClick={onConnect}>
            {t("connect")}
          </Button>
          <p className="m-0 text-center text-[12px] text-muted">{t("connectHint")}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label htmlFor={inputId} className="sr-only">
              {t("stakeLabel")}
            </label>
            <div className="relative w-[118px] flex-none">
              <input
                id={inputId}
                type="number"
                min={MIN_STAKE}
                step={0.5}
                inputMode="decimal"
                value={challenge.stake}
                onChange={(e) => onStake(e.target.value)}
                aria-describedby={`${inputId}-hint`}
                className="input !min-h-[46px] !py-2 !pl-4 !pr-14 font-mono !text-[15px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-dim">
                USDC
              </span>
            </div>
            <Button
              size="sm"
              className="flex-1"
              onClick={onChallenge}
              loading={!!challenge.busy}
              disabled={!!challenge.busy || tooSmall}
            >
              {challenge.busy ? t("working") : t("challenge")}
            </Button>
          </div>
          <p id={`${inputId}-hint`} className="m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-muted">
            <span>{t("min", { amount: MIN_STAKE })}</span>
            {net !== null && !tooSmall ? <span className="font-mono text-cream">{t("payout", { amount: formatUsdcUnits(net) })}</span> : null}
          </p>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px]">
            <span className="text-muted">
              {t("balance")} <span className="font-mono text-cream">{formatUsdcUnits(balance)}</span>
            </span>
            <button type="button" onClick={onManageBalance} className="press rounded-full text-coral transition-colors hover:text-coral-hi">
              {t("manageBalance")}
            </button>
          </div>
        </>
      )}

      {challenge.busy ? (
        <p role="status" className="m-0 flex items-center gap-2 rounded-xl bg-red/[0.1] px-3 py-2 text-[13px] text-pending">
          <span aria-hidden className="live-dot !h-1.5 !w-1.5" />
          {challenge.busy}
        </p>
      ) : null}
      {challenge.log.length > 0 ? (
        <ul className="m-0 grid list-none gap-1 rounded-xl bg-cream/[0.035] p-3 font-mono text-[12px] leading-relaxed text-cream" aria-live="polite">
          {challenge.log.map((l, i) => (
            <li key={i} className="break-words">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      {challenge.lastSig ? (
        <a
          href={`https://explorer.magicblock.app/tx/${challenge.lastSig}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-xl bg-cream/[0.035] px-3 py-2.5 text-[12px] text-muted transition-colors hover:text-cream"
        >
          <span className="min-w-0 truncate">
            {t("tx")} · <span className="font-mono">{challenge.lastSig.slice(0, 16)}…</span>
          </span>
          <span className="shrink-0 text-coral">↗ {t("explorer")}</span>
        </a>
      ) : null}
    </div>
  );
}
