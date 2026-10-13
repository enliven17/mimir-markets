// Address lookup tables (v0 transactions). A builder compiles a tx against the table contents IT
// claims; what runs is whatever the table holds ON CHAIN at those indexes. So the accounts a tx
// really touches are resolved here from RPC, never taken from the builder, and inspectTx checks
// static + loaded keys. Fails closed: a table that cannot be read or an index past its end refuses
// the tx.
//
// Docs: https://solana.com/docs/advanced/lookup-tables (tables are append-only: an address never
// changes once written; a closed table cannot be recreated at the same address, since the address
// derives from a recent slot), https://solana.com/docs/rpc/http/getaccountinfo.
import type { AddressLookupTableAccount, Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SolanaError } from "./util";

export type LookupRpc = Pick<Connection, "getAddressLookupTable">;
/** Accounts loaded from tables, in the order the runtime appends them after the static keys. */
export type Loaded = { writable: string[]; readonly: string[] };

/** Per table: its addresses as last read, and the slot they were read at. */
export type LookupCache = Map<string, { addresses: string[]; slot: number }>;
const MAX_CACHED = 500;
export const createLookupCache = (): LookupCache => new Map();
const shared = createLookupCache();

const refused = (why: string) => new SolanaError("solana", why, { code: "TX_REJECTED", notLanded: true });

async function fetchTable(rpc: LookupRpc, key: PublicKey): Promise<{ addresses: string[]; slot: number }> {
  let res: { context: { slot: number }; value: AddressLookupTableAccount | null };
  try {
    res = await rpc.getAddressLookupTable(key, { commitment: "confirmed" });
  } catch (err) {
    throw refused(`could not read lookup table ${key.toBase58()}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
  }
  if (!res.value) throw refused(`lookup table ${key.toBase58()} not found on chain`);
  return { addresses: res.value.state.addresses.map((a) => a.toBase58()), slot: res.context.slot };
}

/**
 * The accounts `tx` loads from lookup tables, read from chain. Cached per table: an index already
 * read never changes (append-only), and a table is re-read when the tx uses an index beyond it.
 */
export async function resolveLookups(rpc: LookupRpc, tx: VersionedTransaction, cache: LookupCache = shared): Promise<Loaded> {
  const out: Loaded = { writable: [], readonly: [] };
  for (const l of tx.message.addressTableLookups) {
    const key = l.accountKey.toBase58();
    const need = Math.max(-1, ...l.writableIndexes, ...l.readonlyIndexes);
    let t = cache.get(key);
    if (!t || need >= t.addresses.length) {
      t = await fetchTable(rpc, l.accountKey);
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
      cache.set(key, t);
    }
    const at = (i: number) => {
      const a = t.addresses[i];
      if (a === undefined) throw refused(`lookup table ${key} index ${i} is past the end (${t.addresses.length} addresses)`);
      return a;
    };
    out.writable.push(...l.writableIndexes.map(at));
    out.readonly.push(...l.readonlyIndexes.map(at));
  }
  return out;
}
