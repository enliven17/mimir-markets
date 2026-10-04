"use client";

/**
 * The directory of externally registered agents (BYOA).
 *
 * Fetched once on the client so an agent that just registered shows up
 * without waiting on any page cache. The registry API answers an empty list
 * when the database is not configured, which renders the empty state.
 */
import { memo, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { SURFACE } from "@/components/arena/surface";
import { buttonClass } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { Link } from "@/i18n/navigation";
import { explorerUrl } from "@/lib/solana/config";

interface RegisteredAgent {
  agentId: string;
  displayName: string;
  operatorWallet: string;
  authorityLevel: number;
  capabilities: string[];
  status: string;
  createdAt: number;
  lastSeenAt: number | null;
}

/** A heartbeat inside this window reads as live. The CLI beats every 2 minutes, so one missed beat is tolerated. */
const LIVE_WINDOW_MS = 5 * 60 * 1000;
/** Refetch so a terminal closing (or opening) shows up without a reload. */
const REFRESH_MS = 30_000;

const short = (k: string) => (k.length <= 10 ? k : `${k.slice(0, 4)}…${k.slice(-4)}`);

export default function RegisteredAgents() {
  const t = useTranslations("agentConnect");
  const [agents, setAgents] = useState<RegisteredAgent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/agents/registry")
        .then((r) => r.json())
        .then((d: { agents?: RegisteredAgent[] }) => {
          if (!cancelled) setAgents(d.agents ?? []);
        })
        .catch(() => {
          // Keep the last list on a failed refresh; only the first load falls back to empty.
          if (!cancelled) setAgents((prev) => prev ?? []);
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <section aria-labelledby="registered-agents" className="grid gap-4">
      <h2 id="registered-agents" className="m-0 font-display text-[1.6rem] leading-none text-cream">
        {t("directoryTitle")}
        {agents?.length ? <span className="ml-2 font-mono text-[14px] text-muted">{agents.length}</span> : null}
      </h2>
      {agents === null ? (
        <div role="status" aria-label={t("loading")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[132px] rounded-2xl" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <EmptyState
          className="!max-w-[380px]"
          action={
            <Link href="/agents/new" className={`${buttonClass("light", "sm")} !min-h-[40px] !text-[14px]`}>
              {t("connectCta")}
            </Link>
          }
        >
          {t("directoryEmpty")}
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a, i) => (
            <AgentCard key={a.agentId} agent={a} index={i} />
          ))}
        </ul>
      )}
    </section>
  );
}

const AgentCard = memo(function AgentCard({ agent: a, index }: { agent: RegisteredAgent; index: number }) {
  const t = useTranslations("agentConnect");
  const live = a.lastSeenAt !== null && Date.now() - a.lastSeenAt < LIVE_WINDOW_MS;
  const levelName = a.authorityLevel >= 0 && a.authorityLevel <= 4 ? t(`levels.${a.authorityLevel}.name` as never) : "";

  const seen = (() => {
    if (!a.lastSeenAt) return t("never");
    const minutes = Math.floor((Date.now() - a.lastSeenAt) / 60_000);
    if (minutes < 1) return t("justNow");
    if (minutes < 60) return t("minutesAgo", { n: minutes });
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? t("hoursAgo", { n: hours }) : t("daysAgo", { n: Math.floor(hours / 24) });
  })();

  return (
    <li className={`${SURFACE} card-in grid content-start gap-3 p-4`} style={{ "--i": index } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <PeepAvatar seed={`agent-${a.agentId}`} size={44} shape="square" tone={live ? "accent" : "neutral"} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate font-display text-[1.3rem] leading-none text-cream">{a.displayName || a.agentId}</h3>
          <p className="m-0 mt-1 truncate font-mono text-[12px] text-muted">{a.agentId}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ${
            live ? "bg-coral/[0.14] text-coral" : "bg-cream/[0.06] text-muted"
          }`}
        >
          <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${live ? "animate-pulse bg-coral" : "bg-dim"}`} />
          {t(live ? "live" : "offline")}
        </span>
      </div>
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <span className={`inline-flex items-center gap-1.5 ${live ? "text-cream" : ""}`}>
          <span aria-hidden className={`h-[5px] w-[5px] rounded-full ${live ? "bg-coral" : "bg-dim"}`} />
          {t("lastSeen", { when: seen })}
        </span>
        <span aria-hidden>·</span>
        <span>
          L{a.authorityLevel} {levelName}
        </span>
        {a.status !== "active" ? (
          <>
            <span aria-hidden>·</span>
            <span className="text-pending">{a.status}</span>
          </>
        ) : null}
      </p>
      {a.capabilities.length ? (
        <p className="m-0 flex flex-wrap gap-1.5">
          {a.capabilities.map((c) => (
            <span key={c} className="rounded-full bg-cream/[0.06] px-2.5 py-0.5 font-mono text-[11px] text-cream">
              {c}
            </span>
          ))}
        </p>
      ) : null}
      <a
        href={explorerUrl("address", a.operatorWallet)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[12px] text-muted hover:text-coral"
      >
        {t("operator", { address: short(a.operatorWallet) })} ↗
      </a>
    </li>
  );
});
