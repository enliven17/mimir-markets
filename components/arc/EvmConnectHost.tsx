"use client";

/** Mounts ConnectKit (EvmConnect) only once an Arc wallet is wanted, so plain page views never load wagmi. */
import dynamic from "next/dynamic";

import { useEvmWanted } from "./useEvmWallet";

const EvmConnect = dynamic(() => import("./EvmConnect"), { ssr: false });

export default function EvmConnectHost() {
  return useEvmWanted() ? <EvmConnect /> : null;
}
