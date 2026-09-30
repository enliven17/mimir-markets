"use client";

/**
 * V3 optimistic-resolution controls on the claim page:
 *   PROPOSED — the proposed verdict, a live countdown to the end of the dispute
 *              window, the bond and who may post it, a dispute button for
 *              participants, and finalize once the window has closed.
 *   DISPUTED — who disputed and when; the admin (arbiter) rules. If it never
 *              does, anyone can refund everyone after the resolution grace.
 *   OPEN / ACTIVE past the deadline — the refund_expired escape hatch once
 *              deadline + grace has passed.
 * Renders nothing when there is nothing to show. Unstyled block: the action
 * dock supplies the card.
 */
import { useTranslations } from "next-intl";
import type { ApiClaim } from "@/lib/server/arena-claim";
import type { BrowserMimir } from "@/lib/solana/browser-client";
import { disputeResolution, finalizeResolution, refundExpiredFromAnywhere } from "@/lib/solana/browser-client-lazy";
import { canFinalize, canRefundExpired, isDisputable, refundableAt } from "@/lib/solana/lifecycle";
import { DISPUTE_BOND_UNITS, ST_ACTIVE, ST_DISPUTED, ST_OPEN, ST_PROPOSED } from "@/lib/solana/config";
import { toLifecycle } from "@/lib/arena-lifecycle";
import { SIDE_LABEL, formatCountdown } from "@/lib/claim-status";
import { formatUsdcUnits } from "@/lib/money";
import { Button, Disclosure } from "@/components/ui";
import Countdown from "@/components/arena/Countdown";
import { shortKey, useNowSec, useSettleAction } from "./useSettleAction";

interface Props {
  claim: ApiClaim;
  mimir: BrowserMimir | null;
  /** Connected wallet, base58. */
  viewer: string | null;
  onChanged?: () => void;
}

const TITLE = "m-0 text-[12px] text-muted";
const NOTE = "m-0 text-[13px] leading-relaxed text-muted";

export default function DisputePanel({ claim, mimir, viewer, onChanged }: Props) {
  const t = useTranslations("claimSettle");
  // Gating (finalize / refund) needs a clock, not a per-second re-render; the window countdown ticks on its own.
  const now = useNowSec(5_000);
  const { busy, run } = useSettleAction(onChanged);
  const lc = toLifecycle(claim);
  const id = BigInt(claim.id);
  const isParticipant =
    !!viewer && (viewer === claim.creator || claim.challengers.some((c) => c.addr === viewer));

  if (claim.state === ST_PROPOSED) {
    const open = isDisputable(lc, now);
    const finalizable = canFinalize(lc, now) && mimir;
    const disputable = open && isParticipant && mimir;
    return (
      <section className="grid gap-4" aria-label={t("proposedTitle")}>
        <div className="grid gap-1.5">
          <p className={TITLE}>{t("proposedTitle")}</p>
          <p className="m-0 font-display text-[1.7rem] leading-none text-cream">
            {SIDE_LABEL[claim.proposedSide] ?? "—"}
            <span className="ml-2 font-mono text-[14px] text-muted">{claim.confidence}%</span>
          </p>
          {claim.resolutionSummary ? <p className={`${NOTE} line-clamp-3`}>{claim.resolutionSummary}</p> : null}
        </div>

        <dl className="kv">
          <dt>{t("windowCloses")}</dt>
          <dd className="text-cream">{open ? <Countdown until={claim.disputableUntil} /> : t("closed")}</dd>
          <dt>{t("bond")}</dt>
          <dd>{formatUsdcUnits(DISPUTE_BOND_UNITS)}</dd>
          <dt>{t("whoCanDispute")}</dt>
          <dd className="!font-sans">{t("participantsOnly")}</dd>
        </dl>

        {finalizable || disputable ? (
          <div className="grid gap-2">
            {finalizable ? (
              <Button
                size="sm"
                loading={busy === "finalize"}
                disabled={!!busy}
                onClick={() => run("finalize", t("finalizedToast"), () => finalizeResolution(mimir, id))}
              >
                {busy === "finalize" ? t("working") : t("finalizeButton")}
              </Button>
            ) : null}
            {disputable ? (
              <Button
                size="sm"
                variant={finalizable ? "secondary" : "primary"}
                loading={busy === "dispute"}
                disabled={!!busy}
                onClick={() => run("dispute", t("disputedToast"), () => disputeResolution(mimir, id))}
              >
                {busy === "dispute" ? t("working") : t("disputeButton", { bond: formatUsdcUnits(DISPUTE_BOND_UNITS) })}
              </Button>
            ) : null}
          </div>
        ) : !mimir && (open ? isParticipant || !viewer : true) ? (
          <p className={NOTE}>{t("connectToAct")}</p>
        ) : null}

        <Disclosure summary={t("disputeHow")}>
          <p className={NOTE}>
            {open
              ? t("proposedOpenHint", { at: new Date(claim.disputableUntil * 1000).toLocaleString() })
              : t("proposedClosedHint")}
          </p>
          {open ? <p className={`${NOTE} mt-2`}>{t("bondHint")}</p> : null}
        </Disclosure>
      </section>
    );
  }

  if (claim.state === ST_DISPUTED) {
    const refundAt = refundableAt(lc);
    const canRefund = canRefundExpired(lc, now);
    return (
      <section className="grid gap-3" aria-label={t("disputedTitle")}>
        <p className={`${TITLE} !text-danger`}>{t("disputedTitle")}</p>
        <p className="m-0 text-[14px] leading-relaxed text-cream">
          {t("disputedBody", {
            side: SIDE_LABEL[claim.proposedSide] ?? "—",
            who: claim.disputer ? shortKey(claim.disputer) : "—",
            at: claim.disputedAt ? new Date(claim.disputedAt * 1000).toLocaleString() : "—",
          })}
        </p>
        <p className={NOTE}>
          {canRefund ? t("disputedRefundable") : t("disputedRefundIn", { in: formatCountdown(refundAt, now) })}
        </p>
        {canRefund && mimir ? (
          <Button
            size="sm"
            loading={busy === "refund"}
            disabled={!!busy}
            onClick={() => run("refund", t("refundedToast"), () => refundExpiredFromAnywhere(mimir, id))}
          >
            {busy === "refund" ? t("working") : t("refundButton")}
          </Button>
        ) : null}
      </section>
    );
  }

  if ((claim.state === ST_OPEN || claim.state === ST_ACTIVE) && claim.deadline <= now) {
    const refundAt = refundableAt(lc);
    const canRefund = canRefundExpired(lc, now);
    // An OPEN claim nobody joined is usually cancelled by its creator; only
    // show the escape hatch for it once it is actually callable.
    if (claim.state === ST_OPEN && !canRefund) return null;
    return (
      <section className="grid gap-3" aria-label={t("awaitingTitle")}>
        <p className={TITLE}>{t("awaitingTitle")}</p>
        <p className="m-0 text-[14px] leading-relaxed text-cream">
          {canRefund ? t("awaitingRefundable") : t("awaitingBody", { in: formatCountdown(refundAt, now) })}
        </p>
        {canRefund && mimir ? (
          <Button
            size="sm"
            loading={busy === "refund"}
            disabled={!!busy}
            onClick={() => run("refund", t("refundedToast"), () => refundExpiredFromAnywhere(mimir, id))}
          >
            {busy === "refund" ? t("working") : t("refundButton")}
          </Button>
        ) : null}
      </section>
    );
  }
  return null;
}
