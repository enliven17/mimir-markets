/**
 * Arc network config: the chain, Circle's CCTP V2 contracts on both sides,
 * the attestation service and the Modular Wallets endpoint (docs/ARC.md).
 *
 * One switch, NEXT_PUBLIC_ARC_NETWORK (`testnet` default | `mainnet`), moves
 * both sides together: Arc testnet pairs with Solana devnet, Arc mainnet with
 * Solana mainnet. Pure and isomorphic (strings only, no SDK imports), so the
 * server routes and the lazy client chunks share it.
 *
 * On mainnet nothing that points money somewhere falls back to a default: a
 * missing Arc RPC fails loudly (same rule as lib/solana/config.ts).
 */

export type ArcNetwork = "testnet" | "mainnet";

export interface ArcConfig {
  network: ArcNetwork;
  chain: { id: number; name: string; rpcUrl: string; explorer: string };
  /** One balance, two views: native (18 dp, what msg.value spends) and this ERC-20 (6 dp). */
  usdc: `0x${string}`;
  cctp: {
    tokenMessengerV2: `0x${string}`;
    messageTransmitterV2: `0x${string}`;
    /** Circle's attestation service (Iris). */
    irisUrl: string;
    domains: { solana: number; arc: number };
  };
  solana: {
    cluster: "devnet" | "mainnet-beta";
    usdcMint: string;
    /** CCTP V2 programs: the same ids on devnet and mainnet. */
    tokenMessengerMinter: string;
    messageTransmitter: string;
  };
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
  };
  circle: {
    /** Public browser key from Circle Console (allowed domain = the site's exact host). */
    clientKey: string;
    /** Passkey registration / login. */
    passkeyUrl: string;
    /** Bundler + paymaster + chain RPC for this Arc network. */
    modularUrl: string;
  };
}

/** USDC on Arc: native gas token with an ERC-20 interface at this address, on testnet and mainnet. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
export const SOLANA_DOMAIN = 5;
export const ARC_DOMAIN = 26;
/** CCTP finality thresholds: 1000 = fast (soft finality, fee), 2000 = standard (hard finality, no fee). */
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;

const CIRCLE_MODULAR_BASE = "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
const CCTP_SOLANA_PROGRAMS = {
  tokenMessengerMinter: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
  messageTransmitter: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
};

export interface ArcEnv {
  network?: string;
  rpcUrl?: string;
  explorer?: string;
  clientKey?: string;
  mimirV3?: string;
  mimirPool?: string;
  mimirFees?: string;
  fromBlock?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const addressOrNull = (v: string | undefined) => (v && ADDRESS.test(v.trim()) ? (v.trim() as `0x${string}`) : null);
function contractsFrom(env: ArcEnv): ArcConfig["contracts"] {
  const block = env.fromBlock?.trim();
  return {
    mimirV3: addressOrNull(env.mimirV3),
    mimirPool: addressOrNull(env.mimirPool),
    mimirFees: addressOrNull(env.mimirFees),
    fromBlock: block && /^\d+$/.test(block) ? BigInt(block) : 0n,
  };
}

export function parseArcNetwork(value: string | undefined): ArcNetwork {
  return value?.trim() === "mainnet" ? "mainnet" : "testnet";
}

export function arcConfig(env: ArcEnv): ArcConfig {
  const network = parseArcNetwork(env.network);
  const clientKey = env.clientKey?.trim() ?? "";
  if (network === "testnet") {
    return {
      network,
      chain: {
        id: 5042002,
        name: "Arc Testnet",
        rpcUrl: env.rpcUrl?.trim() || "https://rpc.testnet.arc.network",
        explorer: env.explorer?.trim() || "https://testnet.arcscan.app",
      },
      usdc: ARC_USDC,
      cctp: {
        tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
        messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
        irisUrl: "https://iris-api-sandbox.circle.com",
        domains: { solana: SOLANA_DOMAIN, arc: ARC_DOMAIN },
      },
      solana: { cluster: "devnet", usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", ...CCTP_SOLANA_PROGRAMS },
      contracts: contractsFrom(env),
      circle: { clientKey, passkeyUrl: CIRCLE_MODULAR_BASE, modularUrl: `${CIRCLE_MODULAR_BASE}/arcTestnet` },
    };
  }
  const rpcUrl = env.rpcUrl?.trim();
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_ARC_RPC must be set when NEXT_PUBLIC_ARC_NETWORK=mainnet");
  return {
    network,
    // Chain id 5042 is viem's `arc` definition (viem/chains).
    chain: { id: 5042, name: "Arc", rpcUrl, explorer: env.explorer?.trim() || "https://arcscan.app" },
    usdc: ARC_USDC,
    cctp: {
      // CCTP V2 uses the same CREATE2 addresses on every EVM mainnet.
      // TODO(arc-mainnet): confirm both on developers.circle.com/cctp/evm-smart-contracts before real money.
      tokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
      messageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
      irisUrl: "https://iris-api.circle.com",
      domains: { solana: SOLANA_DOMAIN, arc: ARC_DOMAIN },
    },
    solana: { cluster: "mainnet-beta", usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", ...CCTP_SOLANA_PROGRAMS },
    contracts: contractsFrom(env),
    // TODO(arc-mainnet): the SDK and docs do not name the mainnet path; `/arc` follows the viem chain name like `/arcTestnet`.
    circle: { clientKey, passkeyUrl: CIRCLE_MODULAR_BASE, modularUrl: `${CIRCLE_MODULAR_BASE}/arc` },
  };
}

// Literal `process.env.NEXT_PUBLIC_*` reads: Next inlines only those into the browser bundle.
export const ARC: ArcConfig = arcConfig({
  network: process.env.NEXT_PUBLIC_ARC_NETWORK,
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC,
  explorer: process.env.NEXT_PUBLIC_ARC_EXPLORER,
  clientKey: process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY,
  mimirV3: process.env.NEXT_PUBLIC_MIMIR_V3_ADDRESS,
  mimirPool: process.env.NEXT_PUBLIC_MIMIR_POOL_ADDRESS,
  mimirFees: process.env.NEXT_PUBLIC_MIMIR_FEES_ADDRESS,
  fromBlock: process.env.NEXT_PUBLIC_MIMIR_ARC_FROM_BLOCK,
});

export function arcExplorerUrl(kind: "tx" | "address", id: string, config: ArcConfig = ARC): string {
  return `${config.chain.explorer}/${kind}/${id}`;
}

export function solanaExplorerUrl(kind: "tx" | "address", id: string, config: ArcConfig = ARC): string {
  return `https://explorer.solana.com/${kind}/${id}${config.solana.cluster === "devnet" ? "?cluster=devnet" : ""}`;
}
