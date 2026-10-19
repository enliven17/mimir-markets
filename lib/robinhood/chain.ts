/**
 * Robinhood Chain: Robinhood's Arbitrum Orbit L2 (EVM, gas in ETH). Mainnet chain id 4663, testnet 46630.
 * The public RPC is rate limited; set NEXT_PUBLIC_ROBINHOOD_RPC to a provider endpoint for real traffic.
 */
export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  rpcUrl: (process.env.NEXT_PUBLIC_ROBINHOOD_RPC ?? "https://rpc.mainnet.chain.robinhood.com").trim(),
  explorer: "https://robinhoodchain.blockscout.com",
} as const;
