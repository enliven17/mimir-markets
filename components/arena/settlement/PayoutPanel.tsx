"use client";

/**
 * Pull payments for a RESOLVED claim. Nothing is pushed: each winning (or
 * refunded) position is paid by a permissionless crank straight to its
 * owner's USDC token account. The oracle cranks them too; this lets anyone —
 * usually the winner — do it now. A returned dispute bond is cranked the same
 * way. Net amounts are quoted with the claim's frozen, profit-only fee terms.
 */
import { useTranslations } from "next-intl";
import type { ApiClaim } from "@/lib/server/arena-claim";
import {
  payoutChallenger,
  payoutCreator,
  refundBond,
  type BrowserMimir,
} from "@/lib/solana/browser-client";
import { BOND_REFUND_DUE, ST_RESOLVED } from "@/lib/solana/config";
import { challengerGross, creatorGross, splitFees } from "@/lib/solana/fees";
import { formatUsdcUnits } from "@/lib/money";
import { Disclosure } from "@/components/ui";
import { shortKey, useSettleAction } from "./useSettleAction";

interface Props {
  claim: ApiClaim;
  mimir: BrowserMimir | null;
  viewer: string | null;
  onChanged?: () => void;
}

interface Leg {
  key: string;
  role: "creator" | "challenger";
  index: number;
  recipient: string;
  agent: string;
  gross: bigint;
  principal: bigint;
  net: bigint;
  paid: boolean;
}

/** The legs a RESOLVED claim owes, with their after-fee net. */
export function payoutLegs(claim: ApiClaim): Leg[] {
  const creatorStake = BigInt(claim.creatorStake);
  const total = BigInt(claim.totalChallengerStake);
  const policy = (agentFee: boolean) => ({
    platformFeeBps: claim.platformFeeBps,
    agentOwnerFeeBps: agentFee ? claim.agentFeeBps : 0,
    // The recipient is not indexed; a present one is assumed (the program
    // waives the leg only when the recipient is the winner itself).
    platformRecipient: claim.platformFeeBps > 0 ? "platform" : null,
  });
  const legs: Leg[] = [];
  const add = (role: Leg["role"], index: number, recipient: string, agent: string, paid: boolean,
    g: { gross: bigint; principal: bigint } | null) => {
    if (!g) return;
    const hasAgent = Boolean(agent && agent !== recipient);
    const split = splitFees({ gross: g.gross, principal: g.principal, policy: policy(hasAgent), winner: recipient, agentOwner: hasAgent ? agent : null });
    legs.push({ key: `${role}-${index}`, role, index, recipient, agent, gross: g.gross, principal: g.principal, net: split.netPayout, paid });
  };
  add("creator", -1, claim.creator, claim.creatorAgent, claim.creatorPaid, creatorGross(claim.winnerSide, creatorStake, total));
  claim.challengers.forEach((ch, i) =>
    add("challenger", i, ch.addr, ch.agent ?? "", ch.paid, challengerGross(claim.winnerSide, BigInt(ch.stake), creatorStake, total))
  );
  return legs;
}

const BTN = "btn-compact-primary press min-h-[34px] shrink-0 px-3.5 text-[13px]";

/** Unstyled block: the action dock supplies the card. The viewer's own legs sort first. */
export default function PayoutPanel({ claim, mimir, viewer, onChanged }: Props) {
  const t = useTranslations("claimSettle");
  const { busy, run } = useSettleAction(onChanged);
  if (claim.state !== ST_RESOLVED) return null;

  const all = payoutLegs(claim);
  const legs = [...all].sort((a, b) => Number(b.recipient === viewer) - Number(a.recipient === viewer));
  const bondDue = claim.bondState === BOND_REFUND_DUE && claim.disputer;
  if (legs.length === 0 && !bondDue) return null;
  const id = BigInt(claim.id);
  const paid = all.filter((l) => l.paid).length;

  const crank = (leg: Leg) => {
    if (!mimir) return;
    const input = {
      claimId: id,
      recipient: leg.recipient,
      agent: leg.agent,
      agentFeeBps: claim.agentFeeBps,
      hasProfit: leg.gross > leg.principal,
    };
    run(leg.key, t("paidToast"), () =>
      leg.role === "creator" ? payoutCreator(mimir, input) : payoutChallenger(mimir, { ...input, index: leg.index })
    );
  };

  return (
    <section className="grid gap-3" aria-label={t("payoutsTitle")}>
      <p className="m-0 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span>{t("payoutsTitle")}</span>
        <span className="font-mono tabular-nums">
          {paid}/{all.length} {t("paid")}
        </span>
      </p>
      <ul className="m-0 grid max-h-[320px] list-none gap-1.5 overflow-y-auto p-0" data-lenis-prevent>
        {legs.map((leg) => {
          const mine = viewer === leg.recipient;
          return (
            <li key={leg.key} className="flex items-center justify-between gap-3 rounded-xl bg-cream/[0.035] px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="m-0 truncate text-[14px] text-cream">
                  {leg.role === "creator" ? t("creatorLeg") : t("challengerLeg", { n: leg.index + 1 })}{" "}
                  <span className="font-mono text-[12px] text-muted">{shortKey(leg.recipient)}</span>
                  {mine ? <span className="ml-1.5 text-[12px] text-coral">{t("you")}</span> : null}
                </p>
                <p className="m-0 font-mono text-[12px] tabular-nums text-muted">
                  {t("legAmounts", { gross: formatUsdcUnits(leg.gross), net: formatUsdcUnits(leg.net) })}
                </p>
              </div>
              {leg.paid ? (
                <span className="shrink-0 text-[12px] text-win">✓ {t("paid")}</span>
              ) : mimir ? (
                <button type="button" className={BTN} disabled={!!busy} onClick={() => crank(leg)}>
                  {busy === leg.key ? t("working") : mine ? t("claimMine") : t("payOut")}
                </button>
              ) : (
                <span className="shrink-0 text-[12px] text-pending">{t("unpaid")}</span>
              )}
            </li>
          );
        })}
        {bondDue ? (
          <li className="flex items-center justify-between gap-3 rounded-xl bg-cream/[0.035] px-3.5 py-2.5">
            <p className="m-0 min-w-0 truncate text-[14px] text-cream">
              {t("bondLeg")} <span className="font-mono text-[12px] text-muted">{shortKey(claim.disputer)}</span>
            </p>
            {mimir ? (
              <button
                type="button"
                className={BTN}
                disabled={!!busy}
                onClick={() => run("bond", t("bondToast"), () => refundBond(mimir, id, claim.disputer))}
              >
                {busy === "bond" ? t("working") : t("returnBond")}
              </button>
            ) : null}
          </li>
        ) : null}
      </ul>
      <Disclosure summary={t("payoutsHow")}>
        <p className="m-0 text-[13px] leading-relaxed text-muted">{t("payoutsHint")}</p>
      </Disclosure>
    </section>
  );
}
