"use client";

/**
 * The one place UI code reads the wallet: the connected EVM wallet (ConnectKit, components/arc/useEvmWallet.ts), on
 * Arc or Base. Its address is the user's identity everywhere on Mimir. `signMessage` is EIP-191 personal_sign and
 * returns the 0x signature lib/owner.ts verifies; null while nothing is connected.
 */
import { useCallback } from "react";
import type { Address, Hex } from "viem";

import { connectEvm, disconnectEvm, evmNetworkName, signWithEvm, useEvmAccount, type EvmChainIntent } from "@/components/arc/useEvmWallet";

export interface MimirWallet {
  address: Address | null;
  connected: boolean;
  connecting: boolean;
  /** The network picked when connecting, or of the last send. */
  intent: EvmChainIntent | null;
  networkName: string | null;
  connect(intent?: EvmChainIntent): Promise<Address>;
  disconnect(): Promise<void>;
  signMessage: ((message: string) => Promise<Hex>) | null;
}

export function useMimirWallet(): MimirWallet {
  const a = useEvmAccount();
  const address = a.address;
  const sign = useCallback((message: string) => {
    if (!address) return Promise.reject(new Error("Connect your wallet first."));
    return signWithEvm(address, message);
  }, [address]);
  return {
    address,
    connected: Boolean(address),
    connecting: a.connecting,
    intent: a.intent,
    networkName: evmNetworkName(a.intent),
    connect: connectEvm,
    disconnect: disconnectEvm,
    signMessage: address ? sign : null,
  };
}
