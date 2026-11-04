/**
 * A market chain as a viem chain, its RPC transport (the configured URLs in order) and a read-only client. viem core
 * only. Also the USDC balance read in index units (18 dp), whatever the chain.
 */
import { createPublicClient, defineChain, fallback, getAddress, http, parseAbi, type Address, type HttpTransportConfig, type PublicClient, type Transport } from "viem";

import { toIndexUnits } from "./amounts";
import type { MarketChain } from "./registry";

export function viemChainOf(c: MarketChain) {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: c.gas.symbol === "USDC" ? { name: "USDC", symbol: "USDC", decimals: 18 } : { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: c.rpcUrls } },
    blockExplorers: { default: { name: c.explorerName, url: c.explorer } },
  });
}

/** Server-only RPC headers per chain (ARC_RPC_HEADERS / BASE_RPC_HEADERS, JSON); never in the browser. */
function serverRpcHeaders(c: MarketChain): Record<string, string> | undefined {
  if (typeof window !== "undefined") return undefined;
  const raw = (c.id === "arc" ? process.env.ARC_RPC_HEADERS : process.env.BASE_RPC_HEADERS)?.trim();
  if (!raw) return undefined;
  try {
    const h = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(h).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return undefined;
  }
}

export function chainTransport(c: MarketChain, opts?: HttpTransportConfig): Transport {
  if (c.id === "solana") throw new Error("Use the native Solana client for this deployment.");
  const urls = c.rpcUrls.length ? c.rpcUrls : [c.rpcUrl];
  const headers = serverRpcHeaders(c);
  const o: HttpTransportConfig | undefined = headers
    ? { ...opts, fetchOptions: { ...opts?.fetchOptions, headers: { ...(opts?.fetchOptions?.headers as Record<string, string> | undefined), ...headers } } }
    : opts;
  return urls.length === 1 ? http(urls[0], o) : fallback(urls.map((u) => http(u, o)));
}

const clients = new Map<string, PublicClient>();

/** One cached read client per chain config. */
export function chainPublicClient(c: MarketChain): PublicClient {
  const key = `${c.id}:${c.chainId}:${c.rpcUrls.join(",")}`;
  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({ chain: viemChainOf(c), transport: chainTransport(c) }) as PublicClient;
    clients.set(key, client);
  }
  return client;
}

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function nonces(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
]);

/** USDC held, in index units: the native balance on Arc, the ERC-20 balance scaled up on Base. */
export async function usdcBalanceWei(c: MarketChain, wallet: string, supplied?: PublicClient): Promise<bigint> {
  if (c.id === "solana") {
    const [{ PublicKey }, { getAssociatedTokenAddressSync }, { createDevnetConnection }, { SOLANA_RPC, USDC_MINT }] = await Promise.all([
      import("@solana/web3.js"), import("@solana/spl-token"), import("../solana/devnet-connection"), import("../solana/config"),
    ]);
    const connection = createDevnetConnection(SOLANA_RPC);
    const ata = getAssociatedTokenAddressSync(USDC_MINT, new PublicKey(wallet), true);
    const info = await connection.getAccountInfo(ata);
    if (!info) return 0n;
    return BigInt((await connection.getTokenAccountBalance(ata)).value.amount) * 1_000_000_000_000n;
  }
  const address = getAddress(wallet);
  const client = supplied ?? chainPublicClient(c);
  if (c.usdc.kind === "native") return client.getBalance({ address });
  const raw = await client.readContract({ address: getAddress(c.usdc.address), abi: ERC20_ABI, functionName: "balanceOf", args: [address] });
  return toIndexUnits(c, raw);
}

/** The gas token held (ETH on Base, USDC on Arc), in wei (18 dp both). */
export async function gasBalanceWei(c: MarketChain, address: string, supplied?: PublicClient): Promise<bigint> {
  if (c.id === "solana") {
    const [{ PublicKey }, { createDevnetConnection }, { SOLANA_RPC }] = await Promise.all([import("@solana/web3.js"), import("../solana/devnet-connection"), import("../solana/config")]);
    return BigInt(await createDevnetConnection(SOLANA_RPC).getBalance(new PublicKey(address)));
  }
  return (supplied ?? chainPublicClient(c)).getBalance({ address: getAddress(address) });
}

/** The USDC allowance `owner` gave `spender`, in index units (Arc: unlimited, nothing to approve). */
export async function usdcAllowanceWei(c: MarketChain, owner: Address, spender: Address, client: PublicClient = chainPublicClient(c)): Promise<bigint> {
  if (c.usdc.kind === "native") return 2n ** 255n;
  const raw = await client.readContract({ address: getAddress(c.usdc.address), abi: ERC20_ABI, functionName: "allowance", args: [owner, spender] });
  return toIndexUnits(c, raw);
}
