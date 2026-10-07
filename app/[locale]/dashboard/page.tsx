import type { Metadata } from "next";
import { Suspense } from "react";

import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Portfolio · Mimir",
  description: "Your Mimir positions on Arc: markets you opened or joined, your balances and every result.",
};

export default function DashboardPage() {
  // useSearchParams (filter URL state) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-panel/60" aria-busy />}>
      <DashboardClient />
    </Suspense>
  );
}
