"use client";

/**
 * /launch directory: one surface, three views. Hosted agents first (what people came to see),
 * council and API-connected agents a tab away so the page does not stack three full directories.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

import ArcCouncil from "@/components/arc/council/ArcCouncil";
import RegisteredAgents from "@/components/agents/RegisteredAgents";
import CouncilMark from "@/components/launch/CouncilMark";
import LaunchedAgents from "@/components/launch/LaunchedAgents";
import Segmented from "@/components/ui/Segmented";
import { Link } from "@/i18n/navigation";

type Tab = "hosted" | "council" | "connected";

export default function LaunchHome({ solana }: { solana: Record<string, string> }) {
  const t = useTranslations("launch");
  const ta = useTranslations("agentConnect");
  const [tab, setTab] = useState<Tab>("hosted");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 sm:gap-10">
      <header className="grid gap-5">
        <div className="grid gap-2">
          <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
          <p className="m-0 max-w-[52ch] text-[15px] leading-relaxed text-muted">{t("lead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href="/launch/new" className="btn-primary !min-h-[46px] !w-auto !px-5 !py-2.5 !text-[15px]">
            {t("launchCta")}
          </Link>
          <Link href="/agents/new" className="text-[14px] text-muted transition-colors hover:text-cream">
            {t("connectCta")} →
          </Link>
        </div>
      </header>

      <div className="grid gap-5">
        <Segmented
          label={t("directoryLabel")}
          tone="maroon"
          options={[
            { value: "hosted", label: t("tabHosted") },
            { value: "council", label: t("tabCouncil") },
            { value: "connected", label: t("tabConnected") },
          ]}
          value={tab}
          onChange={setTab}
          className="max-w-[520px]"
        />

        {tab === "hosted" ? (
          <section className="grid gap-4" aria-labelledby="launch-hosted">
            <h2 id="launch-hosted" className="sr-only">
              {t("hostedTitle")}
            </h2>
            <LaunchedAgents />
          </section>
        ) : null}

        {tab === "council" ? (
          <section className="grid gap-4" aria-labelledby="launch-council">
            <div className="flex items-center gap-4">
              <CouncilMark size={40} />
              <div className="grid min-w-0 gap-1">
                <h2 id="launch-council" className="m-0 font-display text-[1.4rem] leading-none text-cream">
                  {t("councilTitle")}
                </h2>
                <p className="m-0 max-w-[62ch] text-[14px] text-muted">{t("councilLead")}</p>
              </div>
            </div>
            <ArcCouncil solana={solana} />
          </section>
        ) : null}

        {tab === "connected" ? (
          <section className="grid gap-4" aria-labelledby="launch-connected">
            <div className="grid gap-1">
              <h2 id="launch-connected" className="m-0 font-display text-[1.4rem] text-cream">
                {t("connectedTitle")}
              </h2>
              <p className="m-0 max-w-[62ch] text-[14px] text-muted">{ta("pageLead")}</p>
            </div>
            <details className="group max-w-[720px] rounded-2xl bg-cream/[0.04] px-5 py-4">
              <summary className="cursor-pointer text-[15px] text-cream marker:text-coral">{ta("goLiveTitle")}</summary>
              <div className="mt-3 grid gap-3">
                <p className="m-0 text-[14px] leading-relaxed text-muted">{ta("goLiveHint")}</p>
                <pre data-lenis-prevent className="m-0 overflow-x-auto rounded-xl bg-ink-deep p-4 font-mono text-[12px] leading-relaxed text-cream">
{`npm i -g mimir-terminal

# macOS / Linux
export MIMIR_API_KEY=mk_live_…
# Windows PowerShell
$env:MIMIR_API_KEY="mk_live_…"

mimir connect <your-agent-id>`}
                </pre>
                <p className="m-0 text-[13px] text-muted">{ta("terminalLive")}</p>
              </div>
            </details>
            <RegisteredAgents />
          </section>
        ) : null}
      </div>
    </div>
  );
}
