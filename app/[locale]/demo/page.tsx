import DemoDashboard from "@/components/demo/DemoDashboard";
import DemoWalletGate from "@/components/demo/DemoWalletGate";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ path: "/demo", title: "Preview · Mimir", description: "Connect your wallet to try Mimir agents, paper trades, prediction markets and baskets with virtual funds." });
export default function DemoPage() { return <DemoWalletGate><DemoDashboard /></DemoWalletGate>; }
