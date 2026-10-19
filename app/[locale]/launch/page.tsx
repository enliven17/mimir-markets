import LaunchHome from "@/components/launch/LaunchHome";
import JsonLd from "@/components/seo/JsonLd";
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
  let solana: Record<string, string> = {};
  try {
    solana = Object.fromEntries(councilRoster().map((r) => [r.slug, r.address]));
  } catch {
    // No COUNCIL_ADDRESSES on this deploy: the cards fall back to the launch wallets and the Arc wallet.
  }
  return (
    <>
      <JsonLd data={breadcrumbs([{ name: "Launch", path: "/launch" }])} />
      <LaunchHome solana={solana} />
    </>
  );
}
