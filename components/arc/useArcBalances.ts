"use client";

/**
 * USDC on both sides, in 6-dp base units: the Arc account (native balance)
 * and the connected wallet's Solana USDC account for the Arc network's
 * cluster. Null while unknown; a failed read never pretends to be zero.
 */
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { arcUsdcUnits } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { associatedTokenAddress } from "@/lib/solana/ata";

const POLL_MS = 20_000;
const USDC_MINT = new PublicKey(ARC.solana.usdcMint);

export function useArcBalances(arc: `0x${string}` | null, solana: string | null) {
  const { connection } = useConnection();
  const [arcUnits, setArcUnits] = useState<bigint | null>(null);
  const [solanaUnits, setSolanaUnits] = useState<bigint | null>(null);

  const reload = useCallback(async () => {
    const [a, s] = await Promise.all([
      arc ? arcUsdcUnits(arc).catch(() => null) : Promise.resolve(null),
      solana
        ? connection
            .getTokenAccountBalance(associatedTokenAddress(USDC_MINT, new PublicKey(solana)))
            .then((r) => BigInt(r.value.amount))
            // A missing token account is a real zero, not an unknown.
            .catch((err) => (String(err).includes("could not find account") ? 0n : null))
        : Promise.resolve(null),
    ]);
    setArcUnits(a);
    setSolanaUnits(s);
  }, [arc, solana, connection]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { arcUnits, solanaUnits, reload };
}
