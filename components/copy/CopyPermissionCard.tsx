"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import Button from "@/components/ui/Button";
import Disclosure from "@/components/ui/Disclosure";
import KeyValue from "@/components/ui/KeyValue";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatUsdc } from "@/lib/money";
import type { CopyPermissionView } from "@/lib/copy-client";
import { COPY_CATEGORIES } from "@/lib/copy-form";

type PermissionStatus = "active" | "expired" | "revoked";

function statusOf(p: CopyPermissionView, now: number): PermissionStatus {
  if (!p.active) return "revoked";
  return p.expiresAt <= now ? "expired" : "active";
}

const STATUS_TONE: Record<PermissionStatus, "live" | "neutral" | "danger"> = {
  active: "live",
  expired: "neutral",
  revoked: "danger",
};

const txUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

interface CopyPermissionCardProps {
  permission: CopyPermissionView;
  /** When the list was loaded; status is judged against it so renders stay pure. */
  now: number;
  revoking: boolean;
  /** Another wallet prompt is in flight; one at a time. */
  locked: boolean;
  onRevoke: (id: string) => void;
}

export default function CopyPermissionCard({ permission: p, now, revoking, locked, onRevoke }: CopyPermissionCardProps) {
  const t = useTranslations("copy.card");
  const tCat = useTranslations("copy.categories");
  const format = useFormatter();
  const status = statusOf(p, now);

  const categoryLabel = (c: string) => ((COPY_CATEGORIES as readonly string[]).includes(c) ? tCat(c) : c);

  const caps: Array<[string, string]> = [
    [t("perPosition"), formatUsdc(p.maxPerPositionUsdc)],
    [t("perDay"), formatUsdc(p.maxDailyUsdc)],
    [t("perWeek"), formatUsdc(p.maxWeeklyUsdc)],
  ];
  const limits: Array<[string, string]> = [
    [t("openExposure"), formatUsdc(p.maxOpenExposureUsdc)],
    [t("lossStop"), formatUsdc(p.maxRealizedLossUsdc)],
    [t("minQuality"), `${p.minClaimQuality}/100`],
    [t("minPayout"), `${p.minPayoutRatio}x`],
    [t("categories"), p.allowedCategories.length > 0 ? p.allowedCategories.map(categoryLabel).join(", ") : t("anyCategory")],
  ];

  return (
    <article className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 break-all font-mono text-[15px] text-cream">{p.id}</h3>
          <p className="m-0 mt-1 break-words text-[13px] text-muted">
            {t("copies", { agent: p.signalAgentId })} · {t("executedBy", { agent: p.executionAgentId })}
          </p>
        </div>
        <StatusPill tone={STATUS_TONE[status]}>{t(`status.${status}`)}</StatusPill>
      </header>

      <dl className="m-0 grid grid-cols-3 gap-4">
        {caps.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="truncate text-[11px] uppercase tracking-[0.06em] text-muted">{label}</dt>
            <dd className="m-0 mt-1 truncate font-mono text-[15px] tabular-nums text-cream">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="m-0 text-[13px] text-muted">
        {t("expires")}{" "}
        <time dateTime={new Date(p.expiresAt).toISOString()} className="text-cream">
          {format.dateTime(new Date(p.expiresAt), { dateStyle: "medium", timeStyle: "short" })}
        </time>
        {" · "}
        {t("worstCase", { amount: formatUsdc(p.worstCaseUsdc) })}
      </p>

      <div className="grid gap-2">
        <Disclosure summary={t("limitsTitle")}>
          <KeyValue rows={limits.map(([label, value]) => ({ label, value }))} />
        </Disclosure>
        <Disclosure summary={t("recentTitle")} meta={p.recent.length}>
          {p.recent.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">{t("recentEmpty")}</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {p.recent.map((e) => (
                <li key={`${e.claimId}-${e.at}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <Link href={`/arena/${e.claimId}`} className="font-mono text-cream hover:text-coral">
                    {t("claim", { id: e.claimId })}
                  </Link>
                  <span className={e.executed ? "text-cream" : "text-muted"}>
                    {e.executed
                      ? t("executed", { amount: formatUsdc(e.stakeUsdc) })
                      : t("skipped", { reason: (e.skipReason ?? "unknown").replace(/_/g, " ") })}
                  </span>
                  <time dateTime={new Date(e.at).toISOString()} className="font-mono text-[12px] text-muted">
                    {format.dateTime(new Date(e.at), { dateStyle: "short", timeStyle: "short" })}
                  </time>
                  {e.txSignature ? (
                    <a
                      href={txUrl(e.txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 font-mono text-[12px] text-muted hover:text-coral"
                    >
                      {t("viewTx")}
                      <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </div>

      {status === "active" ? (
        <div className="flex justify-end">
          <Button
            variant="danger"
            size="sm"
            fullWidth={false}
            onClick={() => onRevoke(p.id)}
            disabled={locked}
            loading={revoking}
            aria-label={t("revokeAria", { id: p.id })}
          >
            {revoking ? t("revoking") : t("revoke")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
