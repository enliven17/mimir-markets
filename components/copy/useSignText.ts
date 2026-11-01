"use client";

import { useMimirWallet } from "@/hooks/useMimirWallet";

/**
 * Sign a UTF-8 message with the connected wallet (EIP-191 personal_sign) and return the 0x signature the server
 * verifies (lib/owner.ts). Null while no wallet is connected, so the caller can say so instead of failing mid-flow.
 */
export function useSignText(): ((text: string) => Promise<string>) | null {
  return useMimirWallet().signMessage;
}
