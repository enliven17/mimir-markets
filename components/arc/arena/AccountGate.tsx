"use client";

/**
 * Stands in for a stake or create form until the viewer can use it: Arc not
 * configured, the passkey session still restoring, or no Arc account yet.
 */
import type { ReactNode } from "react";

import Skeleton from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import type { useArcAccount } from "./useArcAccount";
import { BTN_PRIMARY } from "./shared";

export default function AccountGate({ account, children }: { account: ReturnType<typeof useArcAccount>; children: ReactNode }) {
  const { wallet } = account;
  if (!wallet.configured) return <p className="m-0 text-[14px] text-muted">Arc accounts are not configured on this site yet.</p>;
  if (wallet.restoring) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!wallet.session) {
    return (
      <div className="grid gap-3">
        <p className="m-0 text-[14px] leading-relaxed text-muted">
          Markets settle on Arc. Create your Arc account with a passkey (no seed phrase, no gas) and add USDC from your Solana wallet.
        </p>
        <Link href="/wallet" className={`${BTN_PRIMARY} text-center`}>
          Set up your Arc account
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
