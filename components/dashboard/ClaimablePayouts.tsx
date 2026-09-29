"use client";

/**
 * Payout legs the wallet can pull now, across every RESOLVED claim it holds.
 * Each button runs the permissionless payout crank straight to the wallet's
 * USDC token account (the oracle cranks them too; this is just sooner).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Link } from "@/i18n/navigation";
import { payoutChallenger, payoutCreator, type BrowserMimir } from "@/lib/solana/browser-client";
import { claimableLegs, type ClaimableLeg, type PositionClaim } from "@/lib/dashboard-positions";
import { formatUsdcUnits } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";

interface Props {
  claims: PositionClaim[];
  viewer: string;
  mimir: BrowserMimir | null;
  onPaid: () => void;
}

export default function ClaimablePayouts({ claims, viewer, mimir, onPaid }: Props) {
  const t = useTranslations("dashboard");
  const [busy, setBusy] = useState<string | null>(null);
  const byId = new Map(claims.map((c) => [c.id, c]));
  const legs = claims.flatMap((c) => claimableLegs(c, viewer));
  if (legs.length === 0) return null;
  const total = legs.reduce((s, l) => s + l.net, 0n);

  const pull = async (leg: ClaimableLeg) => {
    if (!mimir) return;
    const claim = byId.get(leg.claimId);
    setBusy(leg.key);
    try {
      const input = {
        claimId: BigInt(leg.claimId),
        recipient: leg.recipient,
        agent: leg.agent,
        agentFeeBps: claim?.agentFeeBps ?? 0,
        hasProfit: leg.gross > leg.principal,
      };
      await (leg.role === "creator" ? payoutCreator(mimir, input) : payoutChallenger(mimir, { ...input, index: leg.index }));
      toast.success(t("paidToast", { amount: formatUsdcUnits(leg.net) }));
      onPaid();
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="dashboard-claimable" className="border-b border-pv-border/25 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-claimable" className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-pv-gold">
          {t("claimableTitle")}
        </h2>
        <p className="font-mono text-sm tabular-nums text-pv-gold">{formatUsdcUnits(total)}</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-pv-muted">{t("claimableHint")}</p>
      <ul className="mt-3 divide-y divide-pv-border/15 border border-pv-border/25">
        {legs.map((leg) => (
          <li key={leg.key} className="flex flex-wrap items-center justify-between gap-3 bg-pv-bg px-3 py-2.5">
            <div className="min-w-0">
              <Link href={`/arena/${leg.claimId}`} className="block truncate text-sm text-pv-text hover:text-pv-emerald">
                <span className="mr-1.5 font-mono text-xs text-pv-muted">#{leg.claimId}</span>
                {byId.get(leg.claimId)?.question}
              </Link>
              <p className="font-mono text-[11px] tabular-nums text-pv-muted">
                {t("legAmounts", { gross: formatUsdcUnits(leg.gross), net: formatUsdcUnits(leg.net) })}
              </p>
            </div>
            <button
              type="button"
              className="btn-primary !w-auto !min-h-0 !px-3 !py-1.5 !text-[11px] disabled:opacity-50"
              disabled={!mimir || !!busy}
              onClick={() => void pull(leg)}
            >
              {busy === leg.key ? t("working") : t("pull")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
