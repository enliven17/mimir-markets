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

/**
 * Extra headers for server-side RPC calls (ARC_RPC_HEADERS, JSON), e.g. a keyed provider's secret header or the
 * site origin a domain-locked key expects. Server only: browsers send their own Origin and never see this env.
 */
function serverRpcHeaders(): Record<string, string> | undefined {
  if (typeof window !== "undefined") return undefined;
  const raw = process.env.ARC_RPC_HEADERS?.trim();
  if (!raw) return undefined;
  try {
    const h = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(h).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return undefined;
  }
}

/** The configured RPCs in order: the next one takes over when one fails or rate-limits. */
export function arcTransport(config: ArcConfig = ARC, opts?: HttpTransportConfig): Transport {
  const urls = config.chain.rpcUrls.length ? config.chain.rpcUrls : [config.chain.rpcUrl];
  const headers = serverRpcHeaders();
  const o: HttpTransportConfig | undefined = headers
    ? { ...opts, fetchOptions: { ...opts?.fetchOptions, headers: { ...(opts?.fetchOptions?.headers as Record<string, string> | undefined), ...headers } } }
    : opts;
  return urls.length === 1 ? http(urls[0], o) : fallback(urls.map((u) => http(u, o)));
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

