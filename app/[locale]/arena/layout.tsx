import type { ReactNode } from "react";

import { pageMeta } from "@/lib/seo";

// The Solana wallet context lives in the root layout, so this group only sets its metadata. Pages below set their
// own canonical (a layout's would otherwise be inherited by every market).
export const metadata = pageMeta({
  path: "/arena",
  title: "Arena · Live prediction markets · Mimir Markets",
  description: "Live markets on crypto prices, sports, stocks and more. Take a side with USDC on Arc; an AI oracle settles each one with its reasoning.",
});

export default function ArenaLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
