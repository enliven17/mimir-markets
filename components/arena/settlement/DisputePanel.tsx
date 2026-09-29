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
 * Renders nothing when there is nothing to show.
 */
import { useTranslations } from "next-intl";
import type { ApiClaim } from "@/lib/server/arena-claim";
import {
  disputeResolution,
  finalizeResolution,
  refundExpiredFromAnywhere,
  type BrowserMimir,
} from "@/lib/solana/browser-client";
import { canFinalize, canRefundExpired, isDisputable, refundableAt } from "@/lib/solana/lifecycle";
import { DISPUTE_BOND_UNITS, ST_ACTIVE, ST_DISPUTED, ST_OPEN, ST_PROPOSED } from "@/lib/solana/config";
import { toLifecycle } from "@/lib/arena-lifecycle";
import { SIDE_LABEL, formatCountdown } from "@/lib/claim-status";
import { formatUsdcUnits } from "@/lib/money";
import { shortKey, useNowSec, useSettleAction } from "./useSettleAction";

interface Props {
  claim: ApiClaim;
  mimir: BrowserMimir | null;
  /** Connected wallet, base58. */
  viewer: string | null;
  onChanged?: () => void;
}

const BOX = "card border-pv-border/25 bg-pv-surface p-5 sm:p-6";
const LABEL = "font-mono text-[10px] font-bold uppercase tracking-[0.16em]";
const BTN = "btn-primary !w-auto !min-h-0 !px-4 !py-2 !text-xs disabled:opacity-50";
const GHOST = "btn-ghost !w-auto !min-h-0 !px-4 !py-2 !text-xs disabled:opacity-50";

export default function DisputePanel({ claim, mimir, viewer, onChanged }: Props) {
  const t = useTranslations("claimSettle");
  const now = useNowSec();
  const { busy, run } = useSettleAction(onChanged);
  const lc = toLifecycle(claim);
  const id = BigInt(claim.id);
  const isParticipant =
    !!viewer && (viewer === claim.creator || claim.challengers.some((c) => c.addr === viewer));

  if (claim.state === ST_PROPOSED) {
    const open = isDisputable(lc, now);
    return (
      <section className={`${BOX} border-pv-gold/30`} aria-label={t("proposedTitle")}>
        <p className={`${LABEL} text-pv-gold`}>{t("proposedTitle")}</p>
        <p className="mt-2 font-display text-lg font-bold text-pv-text">
          {SIDE_LABEL[claim.proposedSide] ?? "—"} · {claim.confidence}%
        </p>
        {claim.resolutionSummary ? (
          <p className="mt-1 text-sm leading-relaxed text-pv-text/85">{claim.resolutionSummary}</p>
        ) : null}

        <dl className="mt-4 grid gap-px border border-pv-border/25 bg-pv-border/25 sm:grid-cols-3">
          <div className="bg-pv-bg px-3 py-2.5">
            <dt className={`${LABEL} text-pv-muted`}>{t("windowCloses")}</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-pv-text">
              {open ? formatCountdown(claim.disputableUntil, now) : t("closed")}
            </dd>
          </div>
          <div className="bg-pv-bg px-3 py-2.5">
            <dt className={`${LABEL} text-pv-muted`}>{t("bond")}</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-pv-text">{formatUsdcUnits(DISPUTE_BOND_UNITS)}</dd>
          </div>
          <div className="bg-pv-bg px-3 py-2.5">
            <dt className={`${LABEL} text-pv-muted`}>{t("whoCanDispute")}</dt>
            <dd className="mt-1 text-sm text-pv-text">{t("participantsOnly")}</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs leading-relaxed text-pv-muted">
          {open
            ? t("proposedOpenHint", { at: new Date(claim.disputableUntil * 1000).toLocaleString() })
            : t("proposedClosedHint")}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {open && isParticipant && mimir ? (
            <button
              type="button"
              className={GHOST}
              disabled={!!busy}
              onClick={() => run("dispute", t("disputedToast"), () => disputeResolution(mimir, id))}
            >
              {busy === "dispute" ? t("working") : t("disputeButton", { bond: formatUsdcUnits(DISPUTE_BOND_UNITS) })}
            </button>
          ) : null}
          {canFinalize(lc, now) && mimir ? (
            <button
              type="button"
              className={BTN}
              disabled={!!busy}
              onClick={() => run("finalize", t("finalizedToast"), () => finalizeResolution(mimir, id))}
            >
              {busy === "finalize" ? t("working") : t("finalizeButton")}
            </button>
          ) : null}
          {!mimir && (open ? isParticipant : true) ? <p className="text-xs text-pv-muted">{t("connectToAct")}</p> : null}
        </div>
        {open ? <p className="mt-3 text-[11px] leading-relaxed text-pv-muted">{t("bondHint")}</p> : null}
      </section>
    );
  }

  if (claim.state === ST_DISPUTED) {
    const refundAt = refundableAt(lc);
    const canRefund = canRefundExpired(lc, now);
    return (
      <section className={BOX} aria-label={t("disputedTitle")}>
        <p className={`${LABEL} text-pv-danger`}>{t("disputedTitle")}</p>
        <p className="mt-2 text-sm leading-relaxed text-pv-text/90">
          {t("disputedBody", {
            side: SIDE_LABEL[claim.proposedSide] ?? "—",
            who: claim.disputer ? shortKey(claim.disputer) : "—",
            at: claim.disputedAt ? new Date(claim.disputedAt * 1000).toLocaleString() : "—",
          })}
        </p>
        <p className="mt-2 text-xs text-pv-muted">
          {canRefund ? t("disputedRefundable") : t("disputedRefundIn", { in: formatCountdown(refundAt, now) })}
        </p>
        {canRefund && mimir ? (
          <button
            type="button"
            className={`${BTN} mt-4`}
            disabled={!!busy}
            onClick={() => run("refund", t("refundedToast"), () => refundExpiredFromAnywhere(mimir, id))}
          >
            {busy === "refund" ? t("working") : t("refundButton")}
          </button>
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
      <section className={BOX} aria-label={t("awaitingTitle")}>
        <p className={`${LABEL} text-pv-muted`}>{t("awaitingTitle")}</p>
        <p className="mt-2 text-sm leading-relaxed text-pv-text/90">
          {canRefund ? t("awaitingRefundable") : t("awaitingBody", { in: formatCountdown(refundAt, now) })}
        </p>
        {canRefund && mimir ? (
          <button
            type="button"
            className={`${BTN} mt-4`}
            disabled={!!busy}
            onClick={() => run("refund", t("refundedToast"), () => refundExpiredFromAnywhere(mimir, id))}
          >
            {busy === "refund" ? t("working") : t("refundButton")}
          </button>
        ) : null}
      </section>
    );
  }
  return null;
}
