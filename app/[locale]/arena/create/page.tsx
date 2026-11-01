"use client";

/** /arena/create: open a market on Arc (ArcCreateForm), once its contracts and Convex are configured. */
import ArcCreateForm from "@/components/arc/arena/ArcCreateForm";
import { arcArenaEnabled } from "@/components/arc/arena/enabled";

export default function CreateClaimPage() {
  return arcArenaEnabled ? <ArcCreateForm /> : <p className="m-0 py-10 text-center text-[14px] text-muted">Markets are not configured on this site yet.</p>;
}
