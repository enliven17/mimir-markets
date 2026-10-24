import DemoDashboard from "@/components/demo/DemoDashboard";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ path: "/demo", title: "Preview · Mimir", description: "Try Mimir agents, paper trades, prediction markets and baskets with virtual funds and no wallet." });
export default function DemoPage() { return <DemoDashboard />; }
