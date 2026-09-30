"use client";

/**
 * The review ticket on the create flow's last step: the claim exactly as it
 * will be published (question, both sides, stake, deadline, source, market
 * terms, settlement rule) with the draft id and the signing wallet.
 */
import { SURFACE } from "@/components/arena/surface";
import { useTranslations } from "next-intl";
import Disclosure from "@/components/ui/Disclosure";

/** Compact display for a Solana base58 address: first 4 chars + "…" + last 4. */
function formatWalletForTicket(address: string | null | undefined): string {
  if (!address) return "—";
  const a = address.trim();
  return a.length < 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export type CreateChallengeTicketProps = {
  draftId: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  stakeAmount: number;
  /** Unix seconds; 0 when unset. */
  deadline: number;
  /** Host of the resolution source, or null for none. */
  sourceHost: string | null;
  category: string;
  marketTypeLabel: string;
  oddsModeLabel: string;
  formatLabel: string;
  visibilityLabel: string;
  /** The typed rule, or the category's recommended template. */
  settlementPreview: string;
  walletAddress?: string | null;
};

export default function CreateChallengeTicket(p: CreateChallengeTicketProps) {
  const t = useTranslations("create");
  const tf = useTranslations("arena.create");
  const stake = Number.isFinite(p.stakeAmount) ? p.stakeAmount.toFixed(2) : "—";

  return (
    <div className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
      <div className="flex items-center justify-between gap-3 text-[12px] text-muted">
        <span>{t("challengeTicketTitle")}</span>
        <span className="font-mono text-dim">{p.draftId}</span>
      </div>
      <p className="m-0 text-[18px] leading-snug text-cream [text-wrap:pretty]">{p.question}</p>
      <div className="grid gap-1.5 text-[14px]">
        <p className="m-0 flex items-center gap-2 text-cream">
          <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-[2px] bg-cream" />
          {p.creatorPosition}
        </p>
        <p className="m-0 flex items-center gap-2 text-coral">
          <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-[2px] bg-coral" />
          {p.counterPosition}
        </p>
      </div>
      <dl className="kv">
        <dt>{tf("reviewStake")}</dt>
        <dd className="text-cream">{stake} USDC</dd>
        <dt>{tf("reviewDeadline")}</dt>
        <dd>{p.deadline ? new Date(p.deadline * 1000).toLocaleString() : "—"}</dd>
        <dt>{tf("reviewSource")}</dt>
        <dd>{p.sourceHost ?? tf("reviewNoSource")}</dd>
        <dt>{tf("reviewCategory")}</dt>
        <dd className="!font-sans capitalize">{p.category}</dd>
        <dt>{t("format")}</dt>
        <dd className="!font-sans">
          {p.marketTypeLabel} · {p.oddsModeLabel} · {p.formatLabel}
        </dd>
        <dt>{t("visibility")}</dt>
        <dd className="!font-sans">{p.visibilityLabel}</dd>
      </dl>
      <Disclosure summary={t("settlementRule")}>
        <p className="m-0 text-[13px] leading-relaxed text-muted">{p.settlementPreview.trim() || t("ticketSettlementFallback")}</p>
      </Disclosure>
      <p className="m-0 flex items-center justify-between gap-3 border-t border-dashed border-line-strong pt-3 font-mono text-[12px] text-muted">
        <span>{t("ticketAuthSig")}</span>
        <span>{formatWalletForTicket(p.walletAddress)}</span>
      </p>
    </div>
  );
}
