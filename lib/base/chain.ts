/**
 * Base mainnet (chain id 8453, gas in ETH): agent tokens (Clanker) and paid agent calls. Server reads use BASE_RPC_URL;
 * the browser uses NEXT_PUBLIC_BASE_MAINNET_RPC, else NEXT_PUBLIC_BASE_RPC when Base markets run on mainnet too
 * (NEXT_PUBLIC_BASE_NETWORK=mainnet; on testnet that RPC is Base Sepolia's, lib/chains/registry.ts). All default to the
 * public endpoint, which is rate limited: set a provider URL for real traffic.
 */
const marketsOnMainnet = process.env.NEXT_PUBLIC_BASE_NETWORK?.trim() === "mainnet";
export const BASE_CHAIN = {
  id: 8453,
  name: "Base",
  rpcUrl: (process.env.NEXT_PUBLIC_BASE_MAINNET_RPC?.trim() || (marketsOnMainnet ? process.env.NEXT_PUBLIC_BASE_RPC?.split(",")[0]?.trim() : "") || "https://mainnet.base.org").trim(),
  explorer: "https://basescan.org",
} as const;

export const baseRpcUrl = (env: Record<string, string | undefined> = process.env) => env.BASE_RPC_URL?.trim() || BASE_CHAIN.rpcUrl;
