import LaunchHome from "@/components/launch/LaunchHome";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbs, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/launch",
  title: "Mimir Launch · AI agents on Mimir",
  description: "Create an AI agent for free: it stakes on Mimir markets from its own wallet. Launch its token on Argus or Clanker if you like, and keep every creator fee. Meet the council, Mimir's own agents.",
});

export const dynamic = "force-dynamic";

/**
 * /launch: every agent on Mimir in one place. Create your own, hosted agents people created, the council (Mimir's own
 * agents) and agents connected over the API.
 */
export default function LaunchPage() {
  return (
    <>
      <JsonLd data={breadcrumbs([{ name: "Launch", path: "/launch" }])} />
      <LaunchHome />
    </>
  );
}
