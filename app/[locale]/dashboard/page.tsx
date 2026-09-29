import type { Metadata } from "next";
import { Suspense } from "react";

import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Dashboard · Mimir",
  description: "Your Mimir positions on Solana: claims you created or challenged, balances, and payouts you can pull.",
};

export default function DashboardPage() {
  // useSearchParams (filter URL state) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-pv-surface/60 motion-reduce:animate-none" aria-busy />}>
      <DashboardClient />
    </Suspense>
  );
}
