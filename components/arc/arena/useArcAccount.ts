"use client";

/**
 * The passkey session (restored silently, like /wallet), its USDC on Arc in
 * wei, and its entry fee as MimirFees has it on chain for the account (0.5% by
 * default). Null balance = not known yet. Signed in with an Arc wallet, the balance also counts what
 * the account may draw from that wallet (the spending cap, lib/arc/evm.ts): the session tops itself up on send.
 */
import { useCallback, useEffect, useState } from "react";

import { arcPublicClient, arcUsdcUnits } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { ENTRY_FEE_BPS } from "@/lib/arc/fees";
import { walletSpendableUnits, WEI_PER_UNIT } from "@/lib/arc/evm";
import { MIMIR_FEES_ABI } from "@/lib/arc/markets";
import { useArcWallet } from "../useArcWallet";
import { readWalletFunding } from "../useEvmWallet";

export function useArcAccount() {
  const wallet = useArcWallet();
  const address = wallet.session?.address ?? null;
  const fundedFrom = address && wallet.evmBinding?.arc === address ? wallet.evmBinding.evm : null;
  const [balance, setBalance] = useState<bigint | null>(null);
  // Shown apart, in wei: what sits in the passkey account and what it may still draw from the Arc wallet.
  const [split, setSplit] = useState<{ account: bigint; wallet: bigint } | null>(null);
  const [onchainBps, setOnchainBps] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!address) {
      setBalance(null);
      setSplit(null);
      setOnchainBps(null);
      return;
    }
    const fees = ARC.contracts.mimirFees;
    const [units, fromWallet, bps] = await Promise.all([
      arcUsdcUnits(address).catch(() => null),
      fundedFrom
        ? readWalletFunding(fundedFrom, address)
            .then((f) => walletSpendableUnits(f.allowanceUnits, f.walletUnits))
            .catch(() => 0n)
        : Promise.resolve(0n),
      fees
        ? arcPublicClient()
            .readContract({ address: fees, abi: MIMIR_FEES_ABI, functionName: "entryBps", args: [address] })
            .then(Number)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    // 6-dp units → wei; a failed read stays unknown rather than zero.
    setBalance(units === null ? null : (units + fromWallet) * WEI_PER_UNIT);
    setSplit(units === null || !fundedFrom ? null : { account: units * WEI_PER_UNIT, wallet: fromWallet * WEI_PER_UNIT });
    setOnchainBps(bps);
  }, [address, fundedFrom]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const entryBps = onchainBps ?? ENTRY_FEE_BPS;

  return { wallet, session: wallet.session, address, balance, split, reload, entryBps };
}
