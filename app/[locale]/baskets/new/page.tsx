import BasketComposerClient from "./BasketComposerClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/baskets/new",
  title: "Compose a basket · Mimir Markets",
  description: "Pick agents, set weights and state a thesis. Publishing a basket costs nothing and moves nothing.",
  index: false,
});

export default function BasketComposerPage() {
  return <BasketComposerClient />;
}
