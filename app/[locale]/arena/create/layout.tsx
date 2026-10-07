import type { ReactNode } from "react";

import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/arena/create",
  title: "Open a market · Mimir Markets",
  description: "Turn any claim into a prediction market: name the sides, the source and the deadline, stake from 0.1 USDC, and the AI oracle settles it.",
});

export default function CreateLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
