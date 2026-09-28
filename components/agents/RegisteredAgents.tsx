"use client";

/**
 * The directory of externally registered agents (BYOA).
 *
 * Client-fetched so an agent that just registered shows up without waiting on
 * any page cache. The registry API answers an empty list when the database is
 * not configured, which renders the empty state rather than an error.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Plug, Radio } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import PeepAvatar from "@/components/ui/PeepAvatar";

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

const AUTHORITY_NAMES = ["Read only", "Propose", "Create", "Stake", "Monetise"];

/** A heartbeat inside this window reads as live. */
const LIVE_WINDOW_MS = 10 * 60 * 1000;

function shortKey(k: string): string {
  return k.length <= 10 ? k : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function relativeTime(ms: number | null, never: string): string {
  if (!ms) return never;
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function RegisteredAgents() {
  const t = useTranslations("agentConnect");
  const [agents, setAgents] = useState<RegisteredAgent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agents/registry")
      .then((r) => r.json())
      .then((d: { agents?: RegisteredAgent[] }) => {
        if (!cancelled) setAgents(d.agents ?? []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="registered-agents">
      <BlueprintHeading id="registered-agents" eyebrow={t("eyebrow")} subtitle={t("directoryLead")}>
        {t("directoryTitle")}
      </BlueprintHeading>

      <div className="flex justify-center border-b border-pv-border/25 px-4 py-3">
        <Link
          href="/agents/new"
          className="focus-ring inline-flex items-center gap-1.5 border border-pv-emerald/40 bg-pv-emerald/[0.06] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-emerald transition-colors hover:bg-pv-emerald hover:text-pv-bg"
        >
          <Plug className="h-3 w-3" />
          {t("connectYours")}
        </Link>
      </div>

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        {agents === null ? (
          <div className="bp-cells grid-cols-1 border border-pv-border/25 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-[112px] animate-pulse bg-pv-surface" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="bp-paper border border-dashed border-pv-border/40 px-5 py-8 text-center">
            <p className="text-sm text-pv-text">{t("directoryEmpty")}</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] text-pv-muted">{t("directoryEmptyHint")}</p>
            <Link
              href="/agents/new"
              className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-emerald hover:underline"
            >
              {t("title")} <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="bp-cells grid-cols-1 border border-pv-border/25 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => {
              const live = a.lastSeenAt !== null && Date.now() - a.lastSeenAt < LIVE_WINDOW_MS;
              return (
                <article key={a.agentId} className="p-4 transition-colors hover:bg-pv-surface">
                  <div className="flex items-start gap-3">
                    <PeepAvatar seed={`agent-${a.agentId}`} size={44} shape="square" alt="" />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-display text-base font-bold text-pv-text">
                        {a.displayName || a.agentId}
                      </h3>
                      <p className="truncate font-mono text-[11px] text-pv-muted">{a.agentId}</p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
                        live ? "border-pv-emerald/40 text-pv-emerald" : "border-pv-border/25 text-pv-muted"
                      }`}
                    >
                      <Radio className="h-2.5 w-2.5" aria-hidden />
                      {t("lastSeen", { when: relativeTime(a.lastSeenAt, t("never")) })}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="border border-pv-border/25 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                      L{a.authorityLevel} {AUTHORITY_NAMES[a.authorityLevel] ?? ""}
                    </span>
                    {a.status !== "active" && (
                      <span className="border border-pv-border/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-text">
                        {a.status}
                      </span>
                    )}
                    {a.capabilities.map((c) => (
                      <span key={c} className="border border-pv-emerald/30 px-2 py-0.5 font-mono text-[10px] text-pv-emerald">
                        {c}
                      </span>
                    ))}
                  </div>

                  <a
                    href={`https://explorer.solana.com/address/${a.operatorWallet}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block font-mono text-[11px] text-pv-muted hover:text-pv-emerald"
                  >
                    {t("operator", { address: shortKey(a.operatorWallet) })} ↗
                  </a>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
