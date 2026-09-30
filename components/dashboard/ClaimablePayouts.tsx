"use client";

/**
 * "Ready to claim": payout legs the wallet can pull now, across every
 * RESOLVED claim it holds; renders nothing when there are none. Each button
 * runs the permissionless payout crank straight to the wallet's USDC token
 * account (the oracle cranks them too; this is just sooner).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { SURFACE } from "@/components/arena/surface";
import { Button } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import type { BrowserMimir } from "@/lib/solana/browser-client";
import { payoutChallenger, payoutCreator } from "@/lib/solana/browser-client-lazy";
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
    <section aria-labelledby="dashboard-claimable" className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="dashboard-claimable" className="m-0 flex items-center gap-2 font-display text-[1.4rem] leading-none text-cream">
          <span aria-hidden className="live-dot !h-1.5 !w-1.5" />
          {t("claimableTitle")}
        </h2>
        <p className="m-0 font-mono text-[18px] tabular-nums text-cream">{formatUsdcUnits(total)}</p>
      </div>
      <p className="m-0 -mt-2 text-[13px] leading-relaxed text-muted">{t("claimableHint")}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {legs.map((leg) => (
          <li key={leg.key} className="flex items-center gap-3 rounded-xl bg-cream/[0.035] py-2.5 pl-4 pr-2.5">
            <div className="min-w-0 flex-1">
              <Link href={`/arena/${leg.claimId}`} className="block truncate text-[14px] text-cream hover:text-coral">
                <span className="mr-1.5 font-mono text-[12px] text-dim">#{leg.claimId}</span>
                {byId.get(leg.claimId)?.question}
              </Link>
              <p className="m-0 font-mono text-[12px] tabular-nums text-muted">
                {t("legAmounts", { gross: formatUsdcUnits(leg.gross), net: formatUsdcUnits(leg.net) })}
              </p>
            </div>
            <Button
              size="sm"
              fullWidth={false}
              className="!min-h-[40px] !px-4 !text-[14px]"
              loading={busy === leg.key}
              disabled={!mimir || !!busy}
              onClick={() => void pull(leg)}
            >
              {busy === leg.key ? t("working") : t("pull")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
