/**
 * Checking the owner's seed ETH on Robinhood Chain (or Base, same check with its own client): a plain transfer, successful, from the owner's payout address
 * straight to the agent wallet, of at least the asked amount. Read from the chain, never from what the client claims.
 * A hash is bound to one agent by convex/launch.ts claimLaunch (it cannot fund a second launch).
 */
import type { Hash, PublicClient } from "viem";

export async function verifyRobinhoodFunding(
  client: Pick<PublicClient, "getTransaction" | "getTransactionReceipt">,
  a: { hash: string; from: string; to: string; minWei: bigint; wallet?: string },
): Promise<{ ok: true; wei: bigint } | { ok: false; error: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.hash)) return { ok: false, error: "Not a transaction hash." };
  const hash = a.hash as Hash;
  let tx: Awaited<ReturnType<PublicClient["getTransaction"]>>;
  let receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
  try {
    [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  } catch {
    return { ok: false, error: "Transaction not found yet. Try again in a few seconds." };
  }
  if (receipt.status !== "success") return { ok: false, error: "That transaction failed on chain." };
  if (tx.from.toLowerCase() !== a.from.toLowerCase()) return { ok: false, error: `The transaction was not sent from your ${a.wallet ?? "Robinhood wallet"}.` };
  if (tx.to?.toLowerCase() !== a.to.toLowerCase()) return { ok: false, error: "The transaction does not pay the agent wallet." };
  if (tx.value < a.minWei) return { ok: false, error: `Your wallet sent ${Number(tx.value) / 1e18} ETH to the agent wallet; it needs ${Number(a.minWei) / 1e18}.` };
  return { ok: true, wei: tx.value };
}
