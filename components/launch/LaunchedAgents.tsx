"use client";

/** The hosted agents people launched (convex/launch.ts `list`), live from the backend. */
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { api } from "@/convex/_generated/api";
import Skeleton from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import AgentFace from "./AgentFace";

export default function LaunchedAgents() {
  const t = useTranslations("launch");
  const agents = useQuery(api.launch.list, {});
  if (agents === undefined) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (!agents.length) {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-cream/[0.04] p-5 shadow-[inset_0_0_0_1px_rgb(243_234_214/.06)]">
        <AgentFace seed="njord" size={56} mood="scanning" />
        <p className="m-0 min-w-0 flex-1 text-[15px] text-cream">{t("hostedEmpty")}</p>
        <Link href="/launch/new" className="btn-primary !min-h-[44px] !w-auto !px-5 !py-2 !text-[15px]">
          {t("launchCta")}
        </Link>
      </div>
    );
  }
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
            {a.status !== "live" ? <span className="text-[12px] text-dim">{a.status === "killed" ? "Shut down" : t("paused")}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
