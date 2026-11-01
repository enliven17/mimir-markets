/**
 * Arc network config: the chain, native USDC and Mimir's market contracts (docs/ARC.md).
 *
 * One switch, NEXT_PUBLIC_ARC_NETWORK (`testnet` default | `mainnet`). Pure and isomorphic (strings only, no SDK
 * imports), so the server routes and the browser share it.
 *
 * On mainnet nothing that points money somewhere falls back to a default: a missing Arc RPC fails loudly.
 */

export type ArcNetwork = "testnet" | "mainnet";

export interface ArcConfig {
  network: ArcNetwork;
  /** rpcUrl is the first of rpcUrls; reads and writes fall through the list in order (chain.ts arcTransport). */
  chain: { id: number; name: string; rpcUrl: string; rpcUrls: string[]; explorer: string };
  /** One balance, two views: native (18 dp, what msg.value spends) and this ERC-20 (6 dp). */
  usdc: `0x${string}`;
  /** Mimir's own contracts on this Arc network (scripts/arc/deploy.mjs prints these); null until deployed. */
  contracts: {
    /** VS (duel) markets. */
    mimirV3: `0x${string}` | null;
    /** Two-sided pool markets. */
    mimirPool: `0x${string}` | null;
    /** Entry-fee tiers and holder tickets (both market contracts read it). */
    mimirFees: `0x${string}` | null;
    /** The first block worth indexing (the deploy block). */
    fromBlock: bigint;
    /** The contracts' stake minimum (a deploy parameter), in wei. */
    minStakeWei: bigint;
  };
}

/** USDC on Arc: native gas token with an ERC-20 interface at this address, on testnet and mainnet. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;

export interface ArcEnv {
  network?: string;
  rpcUrl?: string;
  explorer?: string;
  mimirV3?: string;
  mimirPool?: string;
  mimirFees?: string;
  fromBlock?: string;
  /** Decimal USDC, e.g. "0.1"; must match what the contracts were deployed with. */
  minStake?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const addressOrNull = (v: string | undefined) => (v && ADDRESS.test(v.trim()) ? (v.trim() as `0x${string}`) : null);
/** "0.1" → wei; the 2 USDC the first deploys used when unset or malformed. */
function minStakeWei(value: string | undefined): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value?.trim() ?? "");
  if (!m) return 2_000_000_000_000_000_000n;
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] ?? "").padEnd(18, "0"));
}

function contractsFrom(env: ArcEnv): ArcConfig["contracts"] {
  const block = env.fromBlock?.trim();
  return {
    mimirV3: addressOrNull(env.mimirV3),
    mimirPool: addressOrNull(env.mimirPool),
    mimirFees: addressOrNull(env.mimirFees),
    fromBlock: block && /^\d+$/.test(block) ? BigInt(block) : 0n,
    minStakeWei: minStakeWei(env.minStake),
  };
}

/** NEXT_PUBLIC_ARC_RPC / ARC_RPC may be a comma list, tried in order (a public RPC can rate-limit or ban an IP). */
export function parseRpcUrls(value: string | undefined): string[] {
  return (value ?? "").split(",").map((u) => u.trim()).filter(Boolean);
}

export function parseArcNetwork(value: string | undefined): ArcNetwork {
  return value?.trim() === "mainnet" ? "mainnet" : "testnet";
}

export function arcConfig(env: ArcEnv): ArcConfig {
  const network = parseArcNetwork(env.network);
  const rpcUrls = parseRpcUrls(env.rpcUrl);
  if (network === "testnet") {
    if (!rpcUrls.length) rpcUrls.push("https://rpc.testnet.arc.network");
    return {
      network,
      chain: {
        id: 5042002,
        name: "Arc Testnet",
        rpcUrl: rpcUrls[0],
        rpcUrls,
        explorer: env.explorer?.trim() || "https://testnet.arcscan.app",
      },
      usdc: ARC_USDC,
      contracts: contractsFrom(env),
    };
  }
  const rpcUrl = rpcUrls[0];
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_ARC_RPC must be set when NEXT_PUBLIC_ARC_NETWORK=mainnet");
  return {
    network,
    // Chain id 5042 is viem's `arc` definition (viem/chains).
    chain: { id: 5042, name: "Arc", rpcUrl, rpcUrls, explorer: env.explorer?.trim() || "https://explorer.arc.io" },
    usdc: ARC_USDC,
    contracts: contractsFrom(env),
  };
}

// Literal `process.env.NEXT_PUBLIC_*` reads: Next inlines only those into the browser bundle.
export const ARC: ArcConfig = arcConfig({
  network: process.env.NEXT_PUBLIC_ARC_NETWORK,
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC,
  explorer: process.env.NEXT_PUBLIC_ARC_EXPLORER,
  mimirV3: process.env.NEXT_PUBLIC_MIMIR_V3_ADDRESS,
  mimirPool: process.env.NEXT_PUBLIC_MIMIR_POOL_ADDRESS,
  mimirFees: process.env.NEXT_PUBLIC_MIMIR_FEES_ADDRESS,
  fromBlock: process.env.NEXT_PUBLIC_MIMIR_ARC_FROM_BLOCK,
  minStake: process.env.NEXT_PUBLIC_MIMIR_MIN_STAKE,
});

export function arcExplorerUrl(kind: "tx" | "address", id: string, config: ArcConfig = ARC): string {
  return `${config.chain.explorer}/${kind}/${id}`;
}
