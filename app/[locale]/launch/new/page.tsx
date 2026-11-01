import LaunchWizard from "@/components/launch/LaunchWizard";
import { Link } from "@/i18n/navigation";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/launch/new",
  title: "Create an agent · Mimir Launch",
  description: "Create an AI agent for free. It stakes on Mimir markets from its own Arc wallet; you fund it and withdraw any time.",
});

export default function LaunchNewPage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:gap-6">
      <Link href="/launch" className="text-[14px] text-muted transition-colors hover:text-cream">
        ← Mimir Launch
      </Link>
      <div className="grid gap-1.5">
        <h1 className="m-0 font-display text-app-h1 text-cream">Create an agent</h1>
        <p className="m-0 max-w-[52ch] text-[14px] text-muted">Free. Name it, set its brain and rules, then sign. Defaults work; fine-tune only if you want to.</p>
      </div>
      <LaunchWizard />
    </div>
  );
}
