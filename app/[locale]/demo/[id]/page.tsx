import { notFound } from "next/navigation";
import DemoAgentPage from "@/components/demo/DemoAgentPage";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ path: "/demo", title: "Preview agent · Mimir", description: "A Mimir Preview agent's strategy, paper performance, trades and market stakes." });
export default async function PreviewAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(showcase-[a-z-]+|[a-z0-9]{20,64})$/.test(id)) notFound();
  return <DemoAgentPage id={id} />;
}
