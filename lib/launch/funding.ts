// Mimir Launch: checking the owner's seed SOL on chain (ported from snipad lib/server/funding.ts).
import type { Connection, ParsedInstruction, ParsedTransactionWithMeta, PartiallyDecodedInstruction } from "@solana/web3.js";

const SYSTEM = "11111111111111111111111111111111";

/**
 * Lamports moved `from` -> `to` by System Program `transfer` instructions (top level and CPI).
 * Only `transfer` counts: wallets fund with it; `transferWithSeed` debits a seed-derived account, not
 * the member's wallet, so it is not the member paying.
 */
function transferred(tx: ParsedTransactionWithMeta, from: string, to: string): bigint {
  const all: (ParsedInstruction | PartiallyDecodedInstruction)[] = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  let sum = BigInt(0);
  for (const ix of all) {
    if (ix.programId.toBase58() !== SYSTEM || !("parsed" in ix)) continue;
    const p = ix.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number | string } };
    if (p?.type !== "transfer" || p.info?.source !== from || p.info?.destination !== to) continue;
    const l = p.info.lamports;
    if ((typeof l === "number" && Number.isSafeInteger(l) && l >= 0) || (typeof l === "string" && /^\d+$/.test(l))) sum += BigInt(l);
  }
  return sum;
}

/**
 * Did transaction `sig` (confirmed, no error) carry a System Program transfer of at least
 * `minLamports` from `from` (a signer) to `to`, and did `to` actually gain that much? Read from the
 * confirmed transaction itself, never from what the client claims. A signature is bound to one agent
 * by convex/launch.ts claimLaunch (it cannot fund a second launch).
 */
export async function verifyFunding(conn: Pick<Connection, "getParsedTransaction">, a: { sig: string; from: string; to: string; minLamports: bigint }): Promise<{ ok: true; lamports: bigint } | { ok: false; error: string }> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(a.sig)) return { ok: false, error: "Not a transaction signature." };
  let tx: ParsedTransactionWithMeta | null = null;
  try {
    tx = await conn.getParsedTransaction(a.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  } catch {
    return { ok: false, error: "Could not read the transaction. Try again in a few seconds." };
  }
  if (!tx || !tx.meta) return { ok: false, error: "Transaction not found yet. Try again in a few seconds." };
  if (tx.meta.err) return { ok: false, error: "That transaction failed on chain." };
  const keys = tx.transaction.message.accountKeys.map((k) => ({ key: k.pubkey.toBase58(), signer: k.signer }));
  const fromIdx = keys.findIndex((k) => k.key === a.from);
  const toIdx = keys.findIndex((k) => k.key === a.to);
  if (fromIdx < 0 || !keys[fromIdx].signer) return { ok: false, error: "The transaction was not signed by your wallet." };
  if (toIdx < 0) return { ok: false, error: "The transaction does not pay the agent wallet." };
  const sent = transferred(tx, a.from, a.to);
  if (sent === BigInt(0)) return { ok: false, error: "The transaction does not transfer SOL from your wallet to the agent wallet." };
  if (sent < a.minLamports) return { ok: false, error: `Your wallet sent ${Number(sent) / 1e9} SOL to the agent wallet; it needs ${Number(a.minLamports) / 1e9}.` };
  const received = BigInt(tx.meta.postBalances[toIdx]) - BigInt(tx.meta.preBalances[toIdx]);
  if (received < a.minLamports) return { ok: false, error: `The agent wallet received ${Number(received) / 1e9} SOL; it needs ${Number(a.minLamports) / 1e9}.` };
  return { ok: true, lamports: sent };
}
