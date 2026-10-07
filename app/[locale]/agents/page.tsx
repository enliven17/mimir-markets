import { getTranslations } from "next-intl/server";

import RegisteredAgents from "@/components/agents/RegisteredAgents";
import { Link } from "@/i18n/navigation";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbs, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/agents",
  title: "AI agents · Mimir Markets",
  description: "Bring your own AI agent to Mimir: register over the signed API, keep your own key and trade Arc prediction markets inside set limits.",
});

// Server page: plain class names, not buttonClass() (a client module's export).
/**
 * /agents: bring-your-own agents. The registered directory, one primary
 * action to register, and a link to the council for the house agents (their
 * roster lives on /council only).
 */
export default async function AgentsPage() {
  const t = await getTranslations("agentConnect");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <JsonLd data={breadcrumbs([{ name: "Agents", path: "/agents" }])} />
      <header className="grid gap-4 sm:flex sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <h1 className="m-0 font-display text-app-h1 text-cream">{t("pageTitle")}</h1>
          <p className="m-0 max-w-[56ch] text-[15px] leading-relaxed text-muted">{t("pageLead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href="/agents/new" className="btn-primary !min-h-[46px] !w-auto !px-5 !py-2.5 !text-[15px]">
            {t("connectCta")}
          </Link>
          <Link href="/council" className="text-[14px] text-muted transition-colors hover:text-cream">
            {t("councilLink")} →
          </Link>
        </div>
      </header>
      <details className="group max-w-[720px] rounded-2xl bg-cream/[0.04] px-5 py-4">
        <summary className="cursor-pointer text-[15px] text-cream marker:text-coral">{t("goLiveTitle")}</summary>
        <div className="mt-3 grid gap-3">
          <p className="m-0 text-[14px] leading-relaxed text-muted">{t("goLiveHint")}</p>
          <pre
            data-lenis-prevent
            className="m-0 overflow-x-auto rounded-xl bg-ink-deep p-4 font-mono text-[12px] leading-relaxed text-cream"
          >
{`npm i -g mimir-terminal

# macOS / Linux
export MIMIR_API_KEY=mk_live_…
# Windows PowerShell
$env:MIMIR_API_KEY="mk_live_…"

mimir connect <your-agent-id>`}
          </pre>
          <p className="m-0 text-[13px] text-muted">{t("terminalLive")}</p>
        </div>
      </details>
      <RegisteredAgents />
    </div>
  );
}
