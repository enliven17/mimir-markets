"use client";

/**
 * The connected EVM wallet as Robinhood Chain and Base see it: an account that can stand in for the Solana wallet as
 * the owner of an Arc account (lib/owner.ts), fund Pons agents on Robinhood Chain and Clanker agents on Base. It is the
 * site's one ConnectKit connection (components/arc/useEvmWallet.ts), the same account the Arc sign-in uses, so nobody
 * connects twice. Connecting never switches networks; each send switches to its chain first.
 */
import { toHex } from "viem";

import { connectEvm, currentEvmAddress, disconnectEvm, sendEvmEth, signWithEvm, useEvmAccount, type EvmChainIntent } from "@/components/arc/useEvmWallet";
import { BASE_CHAIN } from "@/lib/base/chain";
import { ROBINHOOD_CHAIN } from "@/lib/robinhood/chain";

const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/** Opens the ConnectKit modal (or reuses the live connection). `intent` only records the network the user picked. */
async function connectRobinhood(intent: EvmChainIntent = "robinhood"): Promise<void> {
  await connectEvm(intent);
}

const signRobinhood = async (text: string): Promise<string> => {
  const address = currentEvmAddress();
  if (!address) throw new Error("Connect your EVM wallet first.");
  return signWithEvm(address, toHex(text));
};
const sendEthRobinhood = (to: string, wei: bigint) => sendEvmEth(ROBINHOOD_CHAIN.id, to, wei);
const sendEthBase = (to: string, wei: bigint) => sendEvmEth(BASE_CHAIN.id, to, wei);

export function useRobinhoodWallet() {
  const s = useEvmAccount();
  const address = s.address;
  return {
    address,
    via: s.via,
    connecting: s.connecting,
    intent: s.intent,
    walletConnectReady: Boolean(WALLETCONNECT_PROJECT_ID),
    connect: connectRobinhood,
    disconnect: disconnectEvm,
    sign: address ? signRobinhood : null,
    sendEth: address ? sendEthRobinhood : null,
    sendEthBase: address ? sendEthBase : null,
  };
}
