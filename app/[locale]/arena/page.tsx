"use client";

/**
 * /arena: the market feed on Arc (components/arc/arena/ArcArena.tsx), live from the Convex index. Without the Arc
 * contracts and Convex configured (docs/CHAINS.md) there is nothing to show.
 */
import { useTranslations } from "next-intl";

import ArcArena from "@/components/arc/arena/ArcArena";
import PullToRefresh from "@/components/app/PullToRefresh";
import { arcArenaEnabled } from "@/components/arc/arena/enabled";
import EmptyState from "@/components/ui/EmptyState";

export default function ArenaPage() {
  const t = useTranslations("arena.feed");
  return arcArenaEnabled ? (
    <PullToRefresh>
      <ArcArena />
    </PullToRefresh>
  ) : (
    <EmptyState>{t("offline")}</EmptyState>
  );
}
