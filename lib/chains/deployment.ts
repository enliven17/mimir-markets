import type { MarketChain } from "./registry";

/** Persisted in Convex. A market ID is meaningful only within this exact deployment. */
export interface MarketDeployment {
  chain: string;
  chainId: number;
  network: string;
  v3: string;
  pool: string;
  fees: string;
  usdc: string;
  fromBlock: string;
}

export function marketDeployment(chain: MarketChain): MarketDeployment {
  if (!chain.contracts.mimirV3 || !chain.contracts.mimirPool || !chain.contracts.mimirFees) {
    throw new Error(`${chain.id}: all three market contracts must be configured`);
  }
  return {
    chain: chain.id, chainId: chain.chainId, network: chain.network,
    v3: chain.contracts.mimirV3.toLowerCase(), pool: chain.contracts.mimirPool.toLowerCase(),
    fees: chain.contracts.mimirFees.toLowerCase(), usdc: chain.usdc.address.toLowerCase(),
    fromBlock: chain.contracts.fromBlock.toString(),
  };
}

export function assertSameDeployment(stored: MarketDeployment | null, expected: MarketDeployment): void {
  if (!stored) throw new Error(`${expected.chain}: market deployment is not bound; bind a clean Convex environment before serving markets`);
  for (const key of Object.keys(expected) as (keyof MarketDeployment)[]) {
    if (stored[key] !== expected[key]) {
      throw new Error(`${expected.chain}: deployment mismatch (${key}); use a separate Convex deployment for a different network or contracts`);
    }
  }
}
