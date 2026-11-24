/**
 * Binance Wallet × SPACE ID Agent ID (.ai) on BNB Smart Chain.
 *
 * Mainnet contract (ERC-721 soulbound): 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
 * Testnet override: NEXT_PUBLIC_BSC_AGENT_ID_ADDRESS / BSC_AGENT_ID_ADDRESS.
 *
 * Holding an Agent ID (`balanceOf(address) > 0`) grants 0% entry fees on-chain via
 * MimirBscFees and displays the verified Agent ID badge across the UI.
 */
import { parseAbi, type Address, type PublicClient } from "viem";

import { chainPublicClient } from "../chains/client";
import { MARKET_CHAINS, type MarketChain } from "../chains/registry";

export const BSC_AGENT_ID_MAINNET = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f" as const;

const AGENT_ID_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Configured Agent ID registry address for the active BSC network, or null on testnet if unset. */
export function bscAgentIdAddress(
  network: "testnet" | "mainnet" = MARKET_CHAINS.chains.bsc.network,
  override: string | undefined = process.env.NEXT_PUBLIC_BSC_AGENT_ID_ADDRESS,
): Address | null {
  const raw = override?.trim();
  if (raw && ADDRESS_RE.test(raw)) return raw as Address;
  return network === "mainnet" ? BSC_AGENT_ID_MAINNET : null;
}

/** On-chain check: true iff `account` holds at least one Agent ID (.ai) NFT on BSC. */
export async function hasBscAgentId(
  account: Address,
  opts?: { chain?: MarketChain; registry?: Address | null; client?: PublicClient },
): Promise<boolean> {
  const chain = opts?.chain ?? MARKET_CHAINS.chains.bsc;
  const registry = opts?.registry !== undefined ? opts.registry : bscAgentIdAddress(chain.network);
  if (!registry) return false;
  try {
    const client = opts?.client ?? chainPublicClient(chain);
    const bal = await client.readContract({
      address: registry,
      abi: AGENT_ID_ABI,
      functionName: "balanceOf",
      args: [account],
    });
    return bal > 0n;
  } catch {
    return false;
  }
}
