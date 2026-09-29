"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

/**
 * Sign a UTF-8 message with the connected wallet (ed25519) and return the
 * base58 signature the copy API verifies. Null when the wallet cannot sign
 * messages at all, so the caller can say so instead of failing mid-flow.
 */
export function useSignText(): ((text: string) => Promise<string>) | null {
  const { signMessage } = useWallet();
  const sign = useCallback(
    async (text: string) => {
      if (!signMessage) throw new Error("this wallet cannot sign messages");
      return bs58.encode(await signMessage(new TextEncoder().encode(text)));
    },
    [signMessage],
  );
  return signMessage ? sign : null;
}
