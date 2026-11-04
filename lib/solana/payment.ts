import { PublicKey, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { USDC_MINT } from "./config";
import { PAY_MAX_AGE_MS, type Paid } from "../launch/paid-call";

export const CALL_MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
export const callMemo = (callId: string) => `Mimir devnet call:${callId}`;
/** Count only a confirmed credit to the agent's pinned USDC ATA, bound to the quote's commitment. */
export async function verifySolanaPayment(
  connection: Pick<Connection, "getParsedTransaction">,
  a: { hash: string; to: string; callId: string; min: bigint; now?: number },
): Promise<Paid> {
  let tx = null;
  // RPC transaction history can lag a freshly confirmed transfer by a few seconds.
  for (let attempt = 0; attempt < 3; attempt++) {
    tx = await connection.getParsedTransaction(a.hash, {
      commitment: "confirmed", maxSupportedTransactionVersion: 0,
    }).catch(() => null);
    if (tx?.meta && tx.blockTime) break;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!tx?.meta || tx.meta.err || !tx.blockTime)
    return { ok: false, error: "Confirmed devnet payment not found." };
  const age = (a.now ?? Date.now()) - tx.blockTime * 1000;
  if (age < -60_000 || age > PAY_MAX_AGE_MS)
    return { ok: false, error: "Payment is outside the one-hour window." };
  const memo = tx.transaction.message.instructions.some((ix) => {
    if (!ix.programId.equals(CALL_MEMO_PROGRAM)) return false;
    if ("parsed" in ix) return ix.parsed === callMemo(a.callId);
    try {
      return (
        new TextDecoder().decode(bs58.decode(ix.data)) === callMemo(a.callId)
      );
    } catch {
      return false;
    }
  });
  if (!memo)
    return {
      ok: false,
      error: "Payment does not carry this quote's memo commitment.",
    };
  const address = getAssociatedTokenAddressSync(
    USDC_MINT,
    new PublicKey(a.to),
    true,
  ).toBase58();
  const index = tx.transaction.message.accountKeys.findIndex(
    (k) => k.pubkey.toBase58() === address,
  );
  if (index < 0)
    return {
      ok: false,
      error: "Payment did not reach the agent's USDC account.",
    };
  const amount = (rows: typeof tx.meta.postTokenBalances) =>
    rows
      ?.filter(
        (b) =>
          b.accountIndex === index &&
          b.mint === USDC_MINT.toBase58() &&
          b.owner === a.to &&
          b.uiTokenAmount.decimals === 6,
      )
      .reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n) ?? 0n;
  const units =
    amount(tx.meta.postTokenBalances) - amount(tx.meta.preTokenBalances);
  return units >= a.min
    ? { ok: true, units }
    : {
        ok: false,
        error: "The confirmed test USDC credit is below the quoted price.",
      };
}
