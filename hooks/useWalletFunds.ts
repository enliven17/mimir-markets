"use client";

/**
 * The connected wallet's funds on Solana devnet: SOL for fees, USDC in its
 * token account, and the Mimir virtual balance (a UserBalance PDA that lives
 * on the base layer or, once delegated, in the MagicBlock Ephemeral Rollup).
 * Every value is null while unknown; a failed read never pretends to be zero.
 */
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { associatedTokenAddress } from "@/lib/solana/ata";

import type { BrowserMimir } from "@/lib/solana/browser-client";
import { useBrowserMimir } from "@/lib/solana/browser-client-lazy";
import { balancePda, MIMIR_PROGRAM_ID, USDC_MINT } from "@/lib/solana/config";

export type BalanceLayer = "none" | "base" | "er";

export interface WalletFunds {
  lamports: bigint | null;
  usdcUnits: bigint | null;
  virtualUnits: bigint | null;
  layer: BalanceLayer | null;
}

const EMPTY: WalletFunds = { lamports: null, usdcUnits: null, virtualUnits: null, layer: null };
const POLL_MS = 20_000;

async function readVirtual(m: BrowserMimir, layer: BalanceLayer): Promise<bigint> {
  if (layer === "none") return 0n;
  const program = layer === "er" ? m.er : m.base;
  const b: any = await (program.account as any).userBalance.fetchNullable(balancePda(m.owner));
  return b ? BigInt(b.amount.toString()) : 0n;
}

export function useWalletFunds() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const mimir = useBrowserMimir(wallet);
  const owner = wallet.publicKey;
  const [funds, setFunds] = useState<WalletFunds>(EMPTY);

  const reload = useCallback(async () => {
    if (!owner) {
      setFunds(EMPTY);
      return;
    }
    const ata = associatedTokenAddress(USDC_MINT, owner);
    const [lamports, usdcUnits, layer] = await Promise.all([
      connection.getBalance(owner).then((n) => BigInt(n)).catch(() => null),
      connection
        .getTokenAccountBalance(ata)
        .then((r) => BigInt(r.value.amount))
        // A missing token account is a real zero, not an unknown.
        .catch((err) => (String(err).includes("could not find account") ? 0n : null)),
      connection
        .getAccountInfo(balancePda(owner))
        .then((info): BalanceLayer => (!info ? "none" : info.owner.equals(MIMIR_PROGRAM_ID) ? "base" : "er"))
        .catch(() => null),
    ]);
    const virtualUnits = mimir && layer ? await readVirtual(mimir, layer).catch(() => null) : null;
    setFunds({ lamports, usdcUnits, virtualUnits, layer });
  }, [owner, connection, mimir]);

  useEffect(() => {
    void reload();
    if (!owner) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [owner, reload]);

  return { ...funds, mimir, reload };
}
