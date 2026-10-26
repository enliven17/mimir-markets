import CouncilRadar from "@/components/discovery/CouncilRadar";
import { pageMeta } from "@/lib/seo";
export const metadata = pageMeta({ path: "/radar", title: "Council radar · Mimir Markets", description: "Compare recorded council forecasts and follow markets, topics and agents." });
export default function RadarPage() { return <CouncilRadar />; }
