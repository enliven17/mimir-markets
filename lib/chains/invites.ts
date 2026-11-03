/** Wallet grants are participation rights, not secrets. All authority stays on chain. */
import { getAddress, isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { ARC_V3_ABI } from "./calls";

export function parseInviteWallets(text: string, creator?: string): Address[] {
  const words = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (!words.length) throw new Error("Enter at least one wallet address.");
  const wallets = new Map<string, Address>();
  for (const word of words) {
    if (!isAddress(word)) throw new Error(`Invalid wallet address: ${word}`);
    const address = getAddress(word);
    if (address === zeroAddress || address.toLowerCase() === creator?.toLowerCase()) throw new Error("Use a participant's wallet, not the zero address or creator's wallet.");
    wallets.set(address.toLowerCase(), address);
  }
  if (wallets.size > 100) throw new Error("Change up to 100 wallets per transaction.");
  return [...wallets.values()];
}

/** A failed/legacy read is an error, never permission. Claim 0 is a harmless support probe. */
export async function readClaimInvitation(client: PublicClient, contract: Address, marketId: number, wallet: Address): Promise<boolean> {
  if (!Number.isSafeInteger(marketId) || marketId < 0 || !isAddress(wallet)) throw new Error("Invalid invitation lookup.");
  const allowed = await client.readContract({ address: contract, abi: ARC_V3_ABI, functionName: "invited", args: [BigInt(marketId), wallet] });
  if (typeof allowed !== "boolean") throw new Error("Wallet permissions are unavailable on this contract.");
  return allowed;
}
