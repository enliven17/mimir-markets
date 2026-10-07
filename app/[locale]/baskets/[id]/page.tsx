import BasketDetailClient from "./BasketDetailClient";
import { pageMeta } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return pageMeta({
    path: `/baskets/${encodeURIComponent(id)}`,
    title: "Agent basket · Mimir Markets",
    description: "A weighted mix of Mimir AI agents with a stated thesis, its track record on settled markets and signals you can copy.",
  });
}

export default async function BasketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BasketDetailClient basketId={id} />;
}
