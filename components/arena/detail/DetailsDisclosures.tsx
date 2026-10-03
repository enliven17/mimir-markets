"use client";

/**
 * Terms tab, every row collapsed by default: market terms, fees, how it
 * settles, claim strength, and the on-chain references (claim account,
 * creator, the verification record, the viewer's last challenge tx).
 */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Disclosure from "@/components/ui/Disclosure";
import FeeTermsCard from "@/components/arena/settlement/FeeTermsCard";
import SettlementPreviewCard from "@/components/arena/SettlementPreviewCard";
import type { ApiClaim } from "@/lib/server/arena-claim";
import { claimPda, ST_CANCELLED, ST_RESOLVED, explorerUrl, IS_MAINNET } from "@/lib/solana/config";
import { isLiveState, isPendingVerdict } from "@/lib/claim-status";
import { shortKey } from "@/components/arena/settlement/useSettleAction";
import { sourceOf } from "./source";

const addr = (a: string) => explorerUrl("address", a);

export default function DetailsDisclosures({
  claim,
  now,
  stakeUnits,
  lastSig,
}: {
  claim: ApiClaim;
  now: number;
  /** The amount typed in the dock, for the fee example. */
  stakeUnits: bigint;
  lastSig: string | null;
}) {
  const t = useTranslations("arena.detail.terms");
  const tf = useTranslations("claimSettle");
  const tp = useTranslations("settlementPreview");
  const seats = claim.maxChallengers > 0 ? claim.maxChallengers : 1;
  const { host, isFlash } = sourceOf(claim.resolutionUrl);
  const cancelled = claim.state === ST_CANCELLED;
  const resolved = claim.state === ST_RESOLVED;
  const live = isLiveState(claim.state) && claim.deadline > now;
  const account = (() => {
    try {
      return claimPda(claim.id).toBase58();
    } catch {
      return null;
    }
  })();

  return (
    <div className="grid gap-2.5">
      <Disclosure summary={t("market")}>
        <dl className="kv">
          <dt>{t("category")}</dt>
          <dd className="!font-sans capitalize">{claim.category}</dd>
          <dt>{t("format")}</dt>
          <dd className="!font-sans">{seats === 1 ? t("headToHead") : t("openFormat", { max: seats })}</dd>
          <dt>{t("seats")}</dt>
          <dd>{t("seatsValue", { count: claim.challengers.length, max: seats })}</dd>
          <dt>{t("deadline")}</dt>
          <dd>{new Date(claim.deadline * 1000).toLocaleString()}</dd>
          <dt>{t("settlement")}</dt>
          <dd className="!font-sans">{host}</dd>
        </dl>
      </Disclosure>
      {!cancelled ? (
        <Disclosure summary={tf("feesTitle")}>
          <FeeTermsCard claim={claim} stakeUnits={live ? stakeUnits : 0n} />
        </Disclosure>
      ) : null}
      {!cancelled ? (
        <Disclosure summary={resolved || isPendingVerdict(claim.state) ? tp("titleSettled") : tp("title")}>
          <SettlementPreviewCard claim={claim} />
        </Disclosure>
      ) : null}
      {!resolved && !cancelled ? (
        <Disclosure summary={t("strength")}>
          <p className="m-0 text-[13px] leading-relaxed text-muted">
            <span className="text-cream">{host}</span> · {isFlash ? t("strengthFlash") : t("strengthAi")}
          </p>
        </Disclosure>
      ) : null}
      <Disclosure summary={t("onchain")}>
        <dl className="kv">
          {account ? (
            <>
              <dt>{t("claimAccount")}</dt>
              <dd>
                <a href={addr(account)} target="_blank" rel="noopener noreferrer" className="hover:text-coral">
                  {shortKey(account)} ↗
                </a>
              </dd>
            </>
          ) : null}
          <dt>{t("creatorAccount")}</dt>
          <dd>
            <a href={addr(claim.creator)} target="_blank" rel="noopener noreferrer" className="hover:text-coral">
              {shortKey(claim.creator)} ↗
            </a>
          </dd>
          <dt>{t("record")}</dt>
          <dd>
            <Link href={`/verify/${claim.id}`} className="hover:text-coral">
              /verify/{claim.id}
            </Link>
          </dd>
          {lastSig ? (
            <>
              <dt>{t("lastTx")}</dt>
              <dd>
                <a
                  href={`https://explorer.magicblock.app/tx/${lastSig}${IS_MAINNET ? "" : "?cluster=devnet"}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-coral"
                >
                  {lastSig.slice(0, 10)}… ↗
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      </Disclosure>
    </div>
  );
}
