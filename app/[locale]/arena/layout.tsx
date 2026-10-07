import type { ReactNode } from "react";


// The Solana wallet context now lives in the root layout, so this group
// only needs to set its metadata.
export const metadata = {
  title: "Arena · Mimir on Solana",
  description:
    "Real-time AI claim market on Solana. Challenges run inside a MagicBlock Ephemeral Rollup; price claims resolve against the Flash Trade oracle.",
};

export default function ArenaLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
