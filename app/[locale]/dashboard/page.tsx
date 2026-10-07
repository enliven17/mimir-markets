import { Suspense } from "react";

import DashboardClient from "./DashboardClient";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/dashboard",
  title: "Portfolio · Mimir Markets",
  description: "Your Mimir positions on Arc: markets you opened or joined, your balances and every result.",
  index: false,
});

export default function DashboardPage() {
  // useSearchParams (filter URL state) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-panel/60" aria-busy />}>
      <DashboardClient />
    </Suspense>
  );
}
