"use client";

/** Challengers tab: every wallet on the challenger side, with its holder tier, stake and (once resolved) payout state. */
import { useTranslations } from "next-intl";
import PeepAvatar from "@/components/ui/PeepAvatar";
import HolderBadge from "@/components/token/HolderBadge";
import type { ApiClaim } from "@/lib/server/arena-claim";
import type { TokenTier } from "@/lib/token-tiers";
import { ST_RESOLVED } from "@/lib/solana/config";
import { formatUsdcUnitsBare } from "@/lib/money";
import { shortKey } from "@/components/arena/settlement/useSettleAction";

export default function ChallengersList({
  claim,
  viewer,
  tiers,
}: {
  claim: ApiClaim;
  viewer: string | null;
  tiers: Record<string, TokenTier | undefined>;
}) {
  const t = useTranslations("arena.detail.people");
  const seats = claim.maxChallengers > 0 ? claim.maxChallengers : 1;
  const resolved = claim.state === ST_RESOLVED;

  return (
    <div className="grid gap-3">
      <p className="m-0 text-[13px] text-muted">{t("filled", { count: claim.challengers.length, max: seats })}</p>
      {claim.challengers.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[14px] text-muted" role="status">
          {t("none")}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {claim.challengers.map((c, i) => (
            <li key={`${c.addr}-${i}`} className="flex items-center gap-3 rounded-xl bg-cream/[0.035] px-3 py-2.5">
              <PeepAvatar seed={`challenger-${c.addr}`} size={32} />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono text-[13px] text-cream">{shortKey(c.addr)}</span>
                <HolderBadge tier={tiers[c.addr]} />
                {viewer === c.addr ? <span className="text-[12px] text-coral">{t("you")}</span> : null}
                {resolved ? (
                  <span className={`text-[12px] ${c.paid ? "text-win" : "text-pending"}`}>{c.paid ? t("paid") : t("unpaid")}</span>
                ) : null}
              </div>
              <span className="font-mono text-[14px] tabular-nums text-cream">${formatUsdcUnitsBare(c.stake)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
