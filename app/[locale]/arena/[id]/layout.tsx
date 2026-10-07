import type { ReactNode } from "react";

// Solana-era market pages: kept working, kept out of the index.
export const metadata = { robots: { index: false, follow: true } };

export default function LegacyMarketLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
