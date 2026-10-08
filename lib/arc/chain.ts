/**
 * Arc as a viem chain, and a read-only client on its public RPC (balances,
 * receipts). viem core only: no Circle SDK, so balance reads stay light.
 */
import { createPublicClient, defineChain, fallback, http, type Address, type HttpTransportConfig, type PublicClient, type Transport } from "viem";

import { ARC, type ArcConfig } from "./config";

export function arcChain(config: ArcConfig = ARC) {
  return defineChain({
    id: config.chain.id,
    name: config.chain.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: config.chain.rpcUrls } },
    blockExplorers: { default: { name: "ArcScan", url: config.chain.explorer } },
  });
}

/** The configured RPCs in order: the next one takes over when one fails or rate-limits. */
export function arcTransport(config: ArcConfig = ARC, opts?: HttpTransportConfig): Transport {
  const urls = config.chain.rpcUrls.length ? config.chain.rpcUrls : [config.chain.rpcUrl];
  return urls.length === 1 ? http(urls[0], opts) : fallback(urls.map((u) => http(u, opts)));
}

export function arcPublicClient(config: ArcConfig = ARC): PublicClient {
  return createPublicClient({ chain: arcChain(config), transport: arcTransport(config) }) as PublicClient;
}

/**
 * The account's USDC on Arc in 6-dp base units. Read as the native balance
 * (18 dp) and floored: the ERC-20 view is the same balance in 6 dp.
 */
export async function arcUsdcUnits(address: Address, config: ArcConfig = ARC): Promise<bigint> {
  const wei = await arcPublicClient(config).getBalance({ address });
  return wei / 1_000_000_000_000n;
}

