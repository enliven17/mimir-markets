/**
 * Solana MAINNET RPC list (`SOLANA_MAINNET_RPC`, default the public endpoint;
 * a Helius URL works too). The app and program run on devnet; Mimir Launch
 * and the admin health probe use mainnet.
 */

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

/** SOLANA_MAINNET_RPC may be a comma list (e.g. two Helius keys); the public endpoint is always the last resort. */
export function rpcUrls(value = process.env.SOLANA_MAINNET_RPC): string[] {
  const own = (value ?? "").split(",").map((u) => u.trim()).filter((u) => /^https:\/\//.test(u));
  return [...new Set([...own, DEFAULT_RPC])];
}
