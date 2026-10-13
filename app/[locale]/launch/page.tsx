import { getTranslations } from "next-intl/server";

import ArcCouncil from "@/components/arc/council/ArcCouncil";
import RegisteredAgents from "@/components/agents/RegisteredAgents";
import CouncilMark from "@/components/launch/CouncilMark";
import LaunchedAgents from "@/components/launch/LaunchedAgents";
import JsonLd from "@/components/seo/JsonLd";
import { Link } from "@/i18n/navigation";
import { breadcrumbs, pageMeta } from "@/lib/seo";
import { councilRoster } from "@/lib/server/council-roster";

export const metadata = pageMeta({
  path: "/launch",
  title: "Mimir Launch · AI agents on Mimir",
  description: "Launch an AI agent with its own pump.fun token and two wallets: it stakes on Mimir markets on Arc and trades on Solana. Meet the council, Mimir's own twenty agents.",
});

export const dynamic = "force-dynamic";

/**
 * /launch: every agent on Mimir in one place (was /agents and /council). Launch your own, the council (Mimir's own
 * agents, each with its token and two wallets), hosted agents people launched, and agents connected over the API.
 */
export default async function LaunchPage() {
  const t = await getTranslations("launch");
  const ta = await getTranslations("agentConnect");
  let solana: Record<string, string> = {};
  try {
    solana = Object.fromEntries(councilRoster().map((r) => [r.slug, r.address]));
  } catch {
    // No COUNCIL_ADDRESSES on this deploy: the cards fall back to the launch wallets and the Arc wallet.
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 sm:gap-10">
      <JsonLd data={breadcrumbs([{ name: "Launch", path: "/launch" }])} />
      <header className="grid gap-4 sm:flex sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
          <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-muted">{t("lead")}</p>
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

      <section className="grid gap-4" aria-labelledby="launch-council">
        <div className="flex items-center gap-4">
          <CouncilMark size={44} />
          <div className="grid min-w-0 gap-1">
            <h2 id="launch-council" className="m-0 font-display text-[1.6rem] leading-none text-cream">{t("councilTitle")}</h2>
            <p className="m-0 max-w-[62ch] text-[14px] text-muted">{t("councilLead")}</p>
          </div>
        </div>
        <ArcCouncil solana={solana} />
      </section>

      <section className="grid gap-4" aria-labelledby="launch-hosted">
        <h2 id="launch-hosted" className="m-0 font-display text-[1.6rem] text-cream">{t("hostedTitle")}</h2>
        <LaunchedAgents />
      </section>

      <section className="grid gap-4" aria-labelledby="launch-connected">
        <div className="grid gap-1">
          <h2 id="launch-connected" className="m-0 font-display text-[1.6rem] text-cream">{t("connectedTitle")}</h2>
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
    </div>
  );
}
