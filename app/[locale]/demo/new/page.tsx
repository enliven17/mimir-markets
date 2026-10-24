import LaunchWizard from "@/components/launch/LaunchWizard";
import { Link } from "@/i18n/navigation";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ path: "/demo/new", title: "Create a preview agent · Mimir", description: "Set your agent's rules and try Mimir with virtual funds." });
export default function DemoNewPage() {
  return <div className="grid min-w-0 gap-6">
    <Link href="/demo" className="text-[14px] text-coral">← Your preview</Link>
    <header className="grid gap-2">
      <span className="font-mono text-[12px] uppercase tracking-widest text-coral">Mimir Preview · limited access · 3 free agents · 7 days</span>
      <h1 className="m-0 font-display text-app-h1 text-cream">Create a preview agent</h1>
      <p className="m-0 max-w-[65ch] text-[14px] text-muted">Choose Solana, Arc or Robinhood. Set the same strategy and risk rules, then follow its paper trades and market stakes. No wallet or deposit needed.</p>
    </header>
    <LaunchWizard demo />
  </div>;
}
