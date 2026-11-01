/**
 * The market chains: every network Mimir runs markets on, with its own contracts and its own separate markets
 * (docs/CHAINS.md). Base is the primary network; Arc runs beside it until it is switched off by config.
 *
 *   id        "base" | "arc": the key stored with every indexed row (convex/schema.ts) and used in URLs
 *             (/arena/<chain>/<kind>/<id>)
 *   usdc      Arc: native USDC (18 dp, sent as msg.value, gas paid in it). Base: Circle's ERC-20 USDC (6 dp, pulled with
 *             transferFrom after an approve or an EIP-2612 permit; gas is ETH).
 *   contracts MimirV3 (VS) and MimirPool (two-sided), plus MimirFees; null until deployed. A chain whose two market
 *             contracts are not both configured is disabled: no index, no oracle, no UI, never a crash.
 *
 * Amounts, everywhere off chain (Convex rows, quotes, the UI, agent sizing), are in ONE chain-independent unit: USDC
 * with 18 decimals ("index units", what Arc's native USDC already is). The Base indexer scales 6-dp amounts up by 1e12
 * on the way in; transaction builders scale back down (lib/chains/amounts.ts), refusing sub-unit dust.
 *
 * Switches:
 *   NEXT_PUBLIC_MARKET_CHAINS        enabled chains, comma list (default "base,arc"); a listed chain still needs its contracts
 *   NEXT_PUBLIC_DEFAULT_MARKET_CHAIN where new markets go by default (default: base when enabled, else the first enabled)
 * Backend (Convex env): MARKET_CHAINS and the chain env below without NEXT_PUBLIC_ (serverMarketChains).
 *
 * Pure and isomorphic (strings only), so the browser, the routes and the Convex jobs share it.
 */
import { arcConfig, parseRpcUrls, type ArcConfig } from "../arc/config";

export type MarketChainId = "arc" | "base";
/** Base first: the primary network, listed first wherever chains are listed. */
export const MARKET_CHAIN_IDS: readonly MarketChainId[] = ["base", "arc"];
export type ChainNetwork = "testnet" | "mainnet";

export interface MarketChain {
  id: MarketChainId;
  /** Short name for badges and copy: "Base", "Arc". */
  label: string;
  /** The network's full name: "Base Sepolia", "Arc Testnet". */
  name: string;
  network: ChainNetwork;
  chainId: number;
  /** Tried in order (a public RPC can rate-limit); rpcUrl is the first. */
  rpcUrls: string[];
  rpcUrl: string;
  explorer: string;
  explorerName: string;
  /** What gas is paid in. */
  gas: { symbol: "USDC" | "ETH"; decimals: 18 };
  usdc: {
    /** native: msg.value (Arc). erc20: approve/permit + transferFrom (Base). */
    kind: "native" | "erc20";
    /** On-chain decimals of the amounts the contracts take and emit. */
    decimals: 18 | 6;
    address: `0x${string}`;
    /** EIP-2612 permit (Circle FiatToken v2 on Base); the pool takes ...WithPermit calls. */
    permit: boolean;
  };
  contracts: {
    mimirV3: `0x${string}` | null;
    mimirPool: `0x${string}` | null;
    mimirFees: `0x${string}` | null;
    /** The first block worth indexing (the deploy block). */
    fromBlock: bigint;
    /** The contracts' minimum stake, in index units (18 dp) whatever the chain. */
    minStakeWei: bigint;
  };
  /** Both market contracts are configured and the chain is in the enabled list. */
  enabled: boolean;
}

/** Circle's USDC on Base (FiatToken v2: 6 dp, EIP-2612 permit, version "2"). */
export const BASE_USDC = {
  mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  testnet: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export interface BaseEnv {
  /** "mainnet", or "testnet"/"sepolia" (default). */
  network?: string;
  rpcUrl?: string;
  explorer?: string;
  mimirV3?: string;
  mimirPool?: string;
  mimirFees?: string;
  usdc?: string;
  fromBlock?: string;
  /** Decimal USDC, e.g. "0.1": what the contracts were deployed with (BASE_MIN_STAKE). */
  minStake?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const addressOrNull = (v: string | undefined) => (v && ADDRESS.test(v.trim()) ? (v.trim() as `0x${string}`) : null);
const blockOf = (v: string | undefined) => (v && /^\d+$/.test(v.trim()) ? BigInt(v.trim()) : 0n);

/** "0.1" → 18-dp index units; `fallback` when unset or malformed. */
export function minStakeIndexUnits(value: string | undefined, fallback: bigint): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value?.trim() ?? "");
  if (!m) return fallback;
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
}

export function parseBaseNetwork(value: string | undefined): ChainNetwork {
  return value?.trim() === "mainnet" ? "mainnet" : "testnet";
}

/** Arc as a market chain (lib/arc/config.ts holds the Arc specifics). */
export function arcMarketChain(cfg: ArcConfig, enabledList: readonly MarketChainId[] = MARKET_CHAIN_IDS): MarketChain {
  const configured = Boolean(cfg.contracts.mimirV3 && cfg.contracts.mimirPool);
  return {
    id: "arc",
    label: "Arc",
    name: cfg.chain.name,
    network: cfg.network,
    chainId: cfg.chain.id,
    rpcUrls: cfg.chain.rpcUrls,
    rpcUrl: cfg.chain.rpcUrl,
    explorer: cfg.chain.explorer,
    explorerName: "ArcScan",
    gas: { symbol: "USDC", decimals: 18 },
    usdc: { kind: "native", decimals: 18, address: cfg.usdc, permit: false },
    contracts: { ...cfg.contracts },
    enabled: configured && enabledList.includes("arc"),
  };
}

/** Base (Sepolia by default) as a market chain. Never throws: the public RPC is the fallback on both networks. */
export function baseMarketChain(env: BaseEnv, enabledList: readonly MarketChainId[] = MARKET_CHAIN_IDS): MarketChain {
  const network = parseBaseNetwork(env.network);
  const mainnet = network === "mainnet";
  const rpcUrls = parseRpcUrls(env.rpcUrl);
  if (!rpcUrls.length) rpcUrls.push(mainnet ? "https://mainnet.base.org" : "https://sepolia.base.org");
  const contracts = {
    mimirV3: addressOrNull(env.mimirV3),
    mimirPool: addressOrNull(env.mimirPool),
    mimirFees: addressOrNull(env.mimirFees),
    fromBlock: blockOf(env.fromBlock),
    // The deploy script's default (scripts/base/deploy-markets.mts BASE_MIN_STAKE).
    minStakeWei: minStakeIndexUnits(env.minStake, 100_000_000_000_000_000n),
  };
  return {
    id: "base",
    label: "Base",
    name: mainnet ? "Base" : "Base Sepolia",
    network,
    chainId: mainnet ? 8453 : 84532,
    rpcUrls,
    rpcUrl: rpcUrls[0],
    explorer: env.explorer?.trim() || (mainnet ? "https://basescan.org" : "https://sepolia.basescan.org"),
    explorerName: "BaseScan",
    gas: { symbol: "ETH", decimals: 18 },
    usdc: { kind: "erc20", decimals: 6, address: addressOrNull(env.usdc) ?? BASE_USDC[network], permit: true },
    contracts,
    enabled: Boolean(contracts.mimirV3 && contracts.mimirPool) && enabledList.includes("base"),
  };
}

/** "base,arc" → the listed known chains in order; unset or empty → both. */
export function parseEnabledChains(value: string | undefined): MarketChainId[] {
  const raw = value?.trim();
  if (!raw) return [...MARKET_CHAIN_IDS];
  const out: MarketChainId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if ((id === "arc" || id === "base") && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface MarketChains {
  chains: Record<MarketChainId, MarketChain>;
  /** Enabled chains (configured and listed), Base first. */
  enabled: MarketChainId[];
  /** Where a new market goes unless the user picks another. */
  defaultChain: MarketChainId;
}

export interface RegistryEnv {
  marketChains?: string;
  defaultChain?: string;
  arc: Parameters<typeof arcConfig>[0];
  base: BaseEnv;
}

/** Arc's config throws on mainnet without an RPC; here that only disables Arc. */
function safeArc(env: RegistryEnv["arc"]): ArcConfig {
  try {
    return arcConfig(env);
  } catch {
    const fallback = arcConfig({ ...env, network: "testnet" });
    return { ...fallback, network: "mainnet", contracts: { ...fallback.contracts, mimirV3: null, mimirPool: null } };
  }
}

export function marketChains(env: RegistryEnv): MarketChains {
  const listed = parseEnabledChains(env.marketChains);
  const chains: Record<MarketChainId, MarketChain> = {
    base: baseMarketChain(env.base, listed),
    arc: arcMarketChain(safeArc(env.arc), listed),
  };
  const enabled = MARKET_CHAIN_IDS.filter((id) => chains[id].enabled);
  const wanted = env.defaultChain?.trim().toLowerCase();
  const defaultChain: MarketChainId =
    wanted === "arc" || wanted === "base" ? (enabled.includes(wanted) || !enabled.length ? wanted : enabled[0]) : (enabled[0] ?? "base");
  return { chains, enabled, defaultChain };
}

// Literal `process.env.NEXT_PUBLIC_*` reads: Next inlines only those into the browser bundle.
export const MARKET_CHAINS: MarketChains = marketChains({
  marketChains: process.env.NEXT_PUBLIC_MARKET_CHAINS,
  defaultChain: process.env.NEXT_PUBLIC_DEFAULT_MARKET_CHAIN,
  arc: {
    network: process.env.NEXT_PUBLIC_ARC_NETWORK,
    rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC,
    explorer: process.env.NEXT_PUBLIC_ARC_EXPLORER,
    mimirV3: process.env.NEXT_PUBLIC_MIMIR_V3_ADDRESS,
    mimirPool: process.env.NEXT_PUBLIC_MIMIR_POOL_ADDRESS,
    mimirFees: process.env.NEXT_PUBLIC_MIMIR_FEES_ADDRESS,
    fromBlock: process.env.NEXT_PUBLIC_MIMIR_ARC_FROM_BLOCK,
    minStake: process.env.NEXT_PUBLIC_MIMIR_MIN_STAKE,
  },
  base: {
    network: process.env.NEXT_PUBLIC_BASE_NETWORK,
    rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC,
    explorer: process.env.NEXT_PUBLIC_BASE_EXPLORER,
    mimirV3: process.env.NEXT_PUBLIC_MIMIR_BASE_V3_ADDRESS,
    mimirPool: process.env.NEXT_PUBLIC_MIMIR_BASE_POOL_ADDRESS,
    mimirFees: process.env.NEXT_PUBLIC_MIMIR_BASE_FEES_ADDRESS,
    usdc: process.env.NEXT_PUBLIC_MIMIR_BASE_USDC_ADDRESS,
    fromBlock: process.env.NEXT_PUBLIC_MIMIR_BASE_FROM_BLOCK,
    minStake: process.env.NEXT_PUBLIC_MIMIR_BASE_MIN_STAKE,
  },
});

/** The backend's view (Convex jobs, server routes that run there): the same chains from the non-public env names. */
export function serverMarketChains(e: Record<string, string | undefined> = process.env): MarketChains {
  return marketChains({
    marketChains: e.MARKET_CHAINS,
    defaultChain: e.DEFAULT_MARKET_CHAIN,
    arc: {
      network: e.ARC_NETWORK,
      rpcUrl: e.ARC_RPC,
      mimirV3: e.MIMIR_V3_ADDRESS,
      mimirPool: e.MIMIR_POOL_ADDRESS,
      mimirFees: e.MIMIR_FEES_ADDRESS,
      fromBlock: e.MIMIR_ARC_FROM_BLOCK,
      minStake: e.MIMIR_MIN_STAKE,
    },
    base: {
      network: e.BASE_NETWORK,
      rpcUrl: e.BASE_RPC,
      mimirV3: e.MIMIR_BASE_V3_ADDRESS,
      mimirPool: e.MIMIR_BASE_POOL_ADDRESS,
      mimirFees: e.MIMIR_BASE_FEES_ADDRESS,
      usdc: e.MIMIR_BASE_USDC_ADDRESS,
      fromBlock: e.MIMIR_BASE_FROM_BLOCK,
      minStake: e.MIMIR_BASE_MIN_STAKE,
    },
  });
}

export const isMarketChainId = (v: unknown): v is MarketChainId => v === "arc" || v === "base";

/** The chain's config from the public registry (browser and routes). */
export const marketChain = (id: MarketChainId): MarketChain => MARKET_CHAINS.chains[id];

/** Rows written before Base have no chain: they are Arc's. */
export const chainOfRow = (row: { chain?: MarketChainId | null }): MarketChainId => row.chain ?? "arc";

/** The other chain, for "also on Base/Arc" links. */
export const otherChain = (id: MarketChainId): MarketChainId => (id === "arc" ? "base" : "arc");

export function explorerUrl(chain: MarketChain, kind: "tx" | "address", id: string): string {
  return `${chain.explorer}/${kind}/${id}`;
}

/** The market contract for a kind on a chain, or null when not configured. */
export const marketContract = (chain: MarketChain, kind: "vs" | "pool"): `0x${string}` | null =>
  kind === "vs" ? chain.contracts.mimirV3 : chain.contracts.mimirPool;
