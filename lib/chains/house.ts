/**
 * Mimir's own Circle developer-controlled wallets per market chain (public addresses + Circle wallet ids, no keys):
 *
 *   house creator   ARC_CREATOR_WALLET  / BASE_CREATOR_WALLET    {"id","address"}
 *   council         ARC_COUNCIL_WALLETS / BASE_COUNCIL_WALLETS   {"<slug>": {"id","address"}}
 *
 * Base wallets are Circle wallets on blockchain BASE (mainnet) or BASE-SEPOLIA (scripts/arc/council-wallets.ts
 * --chain base). They pay gas in ETH: Mimir funds them with a little ETH and USDC (no gas station).
 */
import type { MarketChainId } from "./registry";

export type CircleWallet = { id: string; address: `0x${string}` };
type Env = Record<string, string | undefined>;

function json<T>(raw: string | undefined): T | null {
  try {
    return JSON.parse(raw ?? "null") as T;
  } catch {
    return null;
  }
}

const prefix = (chain: MarketChainId) => (chain === "arc" ? "ARC" : "BASE");

export function houseCreatorWallet(chain: MarketChainId, env: Env = process.env): CircleWallet | null {
  const w = json<{ id?: string; address?: string }>(env[`${prefix(chain)}_CREATOR_WALLET`]);
  return w?.id && w?.address ? { id: w.id, address: String(w.address).toLowerCase() as `0x${string}` } : null;
}

export function councilWallets(chain: MarketChainId, env: Env = process.env): Record<string, CircleWallet> {
  return json<Record<string, CircleWallet>>(env[`${prefix(chain)}_COUNCIL_WALLETS`]) ?? {};
}

/** Every address Mimir's agents stake from on any chain (lowercase): the oracle holds markets they are in to firm verdicts. */
export function houseAddresses(env: Env = process.env): string[] {
  const out: string[] = [];
  for (const c of ["arc", "base"] as const) {
    const creator = houseCreatorWallet(c, env);
    if (creator) out.push(creator.address);
    for (const w of Object.values(councilWallets(c, env))) if (w?.address) out.push(w.address.toLowerCase());
  }
  return out;
}

/** The Circle W3S blockchain name for a market chain (developer wallets, transfers). */
export const circleBlockchain = (chain: MarketChainId, network: "testnet" | "mainnet"): string =>
  chain === "arc" ? (network === "mainnet" ? "ARC" : "ARC-TESTNET") : network === "mainnet" ? "BASE" : "BASE-SEPOLIA";

/**
 * The oracle EOA's key for a chain (the contracts' `oracle` role). Base: BASE_ORACLE_KEY, else the Arc key
 * (ARC_ORACLE_KEY) so one settlement address can serve both deployments (deploy Base with BASE_ORACLE = that address).
 * On Base it pays gas in ETH: keep it funded. Null when unset or malformed.
 */
export function oracleKeyFor(chain: MarketChainId, env: Env = process.env): `0x${string}` | null {
  const raw = (chain === "base" ? env.BASE_ORACLE_KEY?.trim() || env.ARC_ORACLE_KEY : env.ARC_ORACLE_KEY)?.trim();
  return raw && /^0x[0-9a-fA-F]{64}$/.test(raw) ? (raw as `0x${string}`) : null;
}
