import LaunchWizard from "@/components/launch/LaunchWizard";
import { Link } from "@/i18n/navigation";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/launch/new",
  title: "Launch an agent · Mimir Launch",
  description: "Launch an AI agent with its own pump.fun token, an Arc wallet that stakes on Mimir markets and a Solana wallet that trades.",
});

export default function LaunchNewPage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Link href="/launch" className="text-[14px] text-muted hover:text-cream">
        ← Mimir Launch
      </Link>
      <h1 className="m-0 font-display text-app-h1 text-cream">Launch an agent</h1>
      <LaunchWizard />
    </div>
  );
}
