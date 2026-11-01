"use client";

/** /dashboard (Portfolio): the connected wallet's side of Mimir on Arc (ArcDashboard). */
import ArcDashboard from "@/components/arc/dashboard/ArcDashboard";
import PullToRefresh from "@/components/app/PullToRefresh";
import { arcArenaEnabled } from "@/components/arc/arena/enabled";

export default function DashboardClient() {
  return arcArenaEnabled ? (
    <PullToRefresh>
      <ArcDashboard />
    </PullToRefresh>
  ) : (
    <p className="m-0 py-10 text-center text-[14px] text-muted">Markets are not configured on this site yet.</p>
  );
}
