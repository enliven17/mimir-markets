"use client";

/**
 * Stands in for a stake or create form until a wallet is connected. The connected EVM wallet is the market account:
 * nothing else to set up, so nobody has to leave the market to find a wallet page.
 */
import type { ReactNode } from "react";

import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import type { useArcAccount } from "./useArcAccount";
import { BTN_PRIMARY } from "./shared";

export default function AccountGate({ account, children }: { account: ReturnType<typeof useArcAccount>; children: ReactNode }) {
  const sheet = useWalletSheet();
  if (account.session) return <>{children}</>;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-[14px] leading-relaxed text-muted">
        Connect a Solana wallet such as Phantom, Solflare or Backpack. Use test USDC and a little devnet SOL for gas.
      </p>
      <button type="button" disabled={account.wallet.connecting} onClick={sheet.open} onPointerEnter={sheet.warm} className={BTN_PRIMARY}>
        {account.wallet.connecting ? "Connecting…" : "Connect wallet"}
      </button>
    </div>
  );
}
