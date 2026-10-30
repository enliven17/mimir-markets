/**
 * Base mainnet (chain id 8453, gas in ETH). Server reads use BASE_RPC_URL; the browser uses NEXT_PUBLIC_BASE_RPC.
 * Both default to the public endpoint, which is rate limited: set a provider URL for real traffic.
 */
export const BASE_CHAIN = {
  id: 8453,
  name: "Base",
  rpcUrl: (process.env.NEXT_PUBLIC_BASE_RPC ?? "https://mainnet.base.org").trim(),
  explorer: "https://basescan.org",
} as const;

export const baseRpcUrl = (env: Record<string, string | undefined> = process.env) => env.BASE_RPC_URL?.trim() || BASE_CHAIN.rpcUrl;
