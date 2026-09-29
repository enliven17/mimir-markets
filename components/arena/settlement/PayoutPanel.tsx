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

const BTN = "btn-primary !w-auto !min-h-0 !px-3 !py-1.5 !text-[11px] disabled:opacity-50";

export default function PayoutPanel({ claim, mimir, viewer, onChanged }: Props) {
  const t = useTranslations("claimSettle");
  const { busy, run } = useSettleAction(onChanged);
  if (claim.state !== ST_RESOLVED) return null;

  const legs = payoutLegs(claim);
  const bondDue = claim.bondState === BOND_REFUND_DUE && claim.disputer;
  if (legs.length === 0 && !bondDue) return null;
  const id = BigInt(claim.id);

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
    <section className="card border-pv-border/25 bg-pv-surface p-5 sm:p-6" aria-label={t("payoutsTitle")}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-gold">{t("payoutsTitle")}</p>
      <p className="mt-1 text-xs leading-relaxed text-pv-muted">{t("payoutsHint")}</p>
      <ul className="mt-4 divide-y divide-pv-border/25 border border-pv-border/25">
        {legs.map((leg) => {
          const mine = viewer === leg.recipient;
          return (
            <li key={leg.key} className="flex flex-wrap items-center justify-between gap-3 bg-pv-bg px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-pv-text">
                  {leg.role === "creator" ? t("creatorLeg") : t("challengerLeg", { n: leg.index + 1 })}{" "}
                  <span className="font-mono text-xs text-pv-muted">{shortKey(leg.recipient)}</span>
                  {mine ? <span className="ml-1.5 font-mono text-[10px] font-bold uppercase text-pv-emerald">{t("you")}</span> : null}
                </p>
                <p className="font-mono text-[11px] tabular-nums text-pv-muted">
                  {t("legAmounts", { gross: formatUsdcUnits(leg.gross), net: formatUsdcUnits(leg.net) })}
                </p>
              </div>
              {leg.paid ? (
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-emerald">✓ {t("paid")}</span>
              ) : mimir ? (
                <button type="button" className={BTN} disabled={!!busy} onClick={() => crank(leg)}>
                  {busy === leg.key ? t("working") : mine ? t("claimMine") : t("payOut")}
                </button>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-pv-gold">{t("unpaid")}</span>
              )}
            </li>
          );
        })}
        {bondDue ? (
          <li className="flex flex-wrap items-center justify-between gap-3 bg-pv-bg px-3 py-2.5">
            <p className="text-sm text-pv-text">
              {t("bondLeg")} <span className="font-mono text-xs text-pv-muted">{shortKey(claim.disputer)}</span>
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
    </section>
  );
}
