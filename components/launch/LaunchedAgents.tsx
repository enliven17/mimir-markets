"use client";

/** The hosted agents people launched (convex/launch.ts `list`), live from the backend. */
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { api } from "@/convex/_generated/api";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import AgentFace from "./AgentFace";

export default function LaunchedAgents() {
  const t = useTranslations("launch");
  const agents = useQuery(api.launch.list, {});
  if (agents === undefined) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (!agents.length) return <EmptyState>{t("hostedEmpty")}</EmptyState>;
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((a) => (
        <li key={a.slug}>
          <Link href={`/launch/${a.slug}`} className="flex items-center gap-3 rounded-2xl bg-[rgb(27_19_20/.93)] p-4 shadow-card transition-colors hover:bg-[rgb(36_24_25)]">
            <AgentFace seed={a.avatarSeed} size={44} mood={a.status === "paused" ? "paused" : "neutral"} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate font-display text-[1.25rem] leading-none text-cream">{a.name}</p>
              <p className="m-0 mt-1 truncate text-[12px] text-muted">
                <span className="mr-1.5 font-mono text-coral">${a.ticker}</span>
                {[a.markets.enabled ? t("doesMarkets") : null, a.trading.enabled ? t("doesTrading") : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            {a.status === "paused" ? <span className="text-[12px] text-dim">{t("paused")}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
