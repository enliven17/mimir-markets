// Test fakes for the Solana layer (imported only by *.test.ts). A fake Connection that simulates a
// tiny ledger, a fake Privy that signs with a local keypair, and a recording fetch.
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { Conn } from "./submit";

export type Call = { url: string; init: RequestInit; body: unknown };

export function recordingFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const raw = init.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw;
    const call = { url, init, body };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const bytes = (b: Uint8Array, status = 200) => new Response(Buffer.from(b), { status, headers: { "content-type": "application/octet-stream" } });

/** Unsigned v0 tx with one no-data instruction per program (what a builder like PumpPortal returns). */
export function unsignedTx(payer: PublicKey, programs: string[], extraSigners: PublicKey[] = []): VersionedTransaction {
  const instructions = programs.map(
    (p, i) =>
      new TransactionInstruction({
        programId: new PublicKey(p),
        keys: [{ pubkey: payer, isSigner: true, isWritable: true }, ...(i === 0 ? extraSigners.map((s) => ({ pubkey: s, isSigner: true, isWritable: true })) : [])],
        data: Buffer.from([i]),
      }),
  );
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), instructions }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function fakePrivy(walletKp: Keypair, o: { fail?: () => Error | null } = {}) {
  const seen: VersionedTransaction[] = [];
  return {
    seen,
    async signTransaction(_walletId: string, txBase64: string): Promise<string> {
      const err = o.fail?.();
      if (err) throw err;
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
      seen.push(VersionedTransaction.deserialize(tx.serialize()));
      tx.sign([walletKp]);
      return Buffer.from(tx.serialize()).toString("base64");
    },
  };
}

export type Effect = { sol: bigint; token?: { mint: string; owner: string; decimals: number; pre: bigint; post: bigint } };

type ConnOpts = {
  balance?: bigint;
  accounts?: Map<string, AccountInfo<Buffer>>;
  tokenBalance?: bigint;
  /** What a landed tx does to the payer. */
  effect?: Effect | ((tx: VersionedTransaction) => Effect);
  /** Throw from sendRawTransaction on the given (1-based) call. */
  sendError?: (n: number) => Error | null;
  /** Status the cluster reports for a sig: "confirmed" | null (unknown) | {err}. */
  status?: (sig: string, n: number) => "confirmed" | null | { err: unknown };
  blockHeight?: (n: number) => number;
  simulateUnits?: number;
  /** Lamports the simulated tx takes out of the wallet (SOL-out guard). */
  simulateSolOut?: bigint;
  /** Post-simulation data of non-wallet accounts (e.g. token accounts), by address. */
  simulateAccounts?: Map<string, Buffer>;
  /** On-chain address lookup tables: key -> addresses. */
  lookupTables?: Map<string, string[]>;
};

export function fakeConnection(o: ConnOpts = {}) {
  const sent: VersionedTransaction[] = [];
  const counters = { send: 0, status: 0, height: 0, blockhash: 0 };
  const landed = new Map<string, VersionedTransaction>();
  const conn = {
    sent,
    counters,
    async getBalance() {
      return Number(o.balance ?? BigInt(0));
    },
    async getAccountInfo(key: PublicKey) {
      return o.accounts?.get(key.toBase58()) ?? null;
    },
    async getTokenAccountBalance() {
      return { context: { slot: 1 }, value: { amount: String(o.tokenBalance ?? BigInt(0)), decimals: 6, uiAmount: null } };
    },
    async getAddressLookupTable(key: PublicKey) {
      const addrs = o.lookupTables?.get(key.toBase58());
      const value = addrs ? new AddressLookupTableAccount({ key, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: addrs.map((a) => new PublicKey(a)) } }) : null;
      return { context: { slot: 1 }, value };
    },
    async getLatestBlockhash() {
      counters.blockhash += 1;
      return { blockhash: bs58.encode(Buffer.alloc(32, 9 + counters.blockhash)), lastValidBlockHeight: 1_000 };
    },
    async simulateTransaction(_tx: unknown, cfg?: { accounts?: { addresses: string[] } }) {
      const post = Number((o.balance ?? BigInt(0)) - (o.simulateSolOut ?? BigInt(0)));
      const accounts = cfg?.accounts
        ? cfg.accounts.addresses.map((a, i) => ({ lamports: post, owner: "11111111111111111111111111111111", data: [i > 0 ? (o.simulateAccounts?.get(a)?.toString("base64") ?? "") : "", "base64"], executable: false, rentEpoch: 0 }))
        : null;
      return { context: { slot: 1 }, value: { err: null, logs: [], accounts, unitsConsumed: o.simulateUnits ?? 100_000, returnData: null } };
    },
    async sendRawTransaction(raw: Uint8Array | Buffer) {
      counters.send += 1;
      const tx = VersionedTransaction.deserialize(raw);
      sent.push(tx);
      const err = o.sendError?.(counters.send);
      if (err) throw err;
      return bs58.encode(tx.signatures[0]);
    },
    async getSignatureStatuses(sigs: string[]) {
      counters.status += 1;
      const s = o.status ? o.status(sigs[0], counters.status) : "confirmed";
      if (s === "confirmed") for (const tx of sent) if (bs58.encode(tx.signatures[0]) === sigs[0]) landed.set(sigs[0], tx);
      const value = s === null ? null : s === "confirmed" ? { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" as const } : { slot: 1, confirmations: 1, err: s.err, confirmationStatus: "confirmed" as const };
      return { context: { slot: 1 }, value: [value] };
    },
    async getBlockHeight() {
      counters.height += 1;
      return o.blockHeight ? o.blockHeight(counters.height) : 10;
    },
    async getTransaction(sig: string): Promise<VersionedTransactionResponse | null> {
      const tx = landed.get(sig);
      if (!tx) return null;
      const at = (key: PublicKey, idx: number[]) => idx.map((i) => new PublicKey(o.lookupTables?.get(key.toBase58())?.[i] ?? PublicKey.default));
      const loaded = { writable: tx.message.addressTableLookups.flatMap((l) => at(l.accountKey, l.writableIndexes)), readonly: tx.message.addressTableLookups.flatMap((l) => at(l.accountKey, l.readonlyIndexes)) };
      return responseFor(tx, typeof o.effect === "function" ? o.effect(tx) : (o.effect ?? { sol: BigInt(0) }), 5_000, loaded);
    },
  };
  return conn as typeof conn & Conn;
}

/** A getTransaction-shaped response where the fee payer's balances move by `effect`. */
export function responseFor(tx: VersionedTransaction, effect: Effect, fee = 5_000, loaded: { writable: PublicKey[]; readonly: PublicKey[] } = { writable: [], readonly: [] }): VersionedTransactionResponse {
  const n = tx.message.staticAccountKeys.length + loaded.writable.length + loaded.readonly.length;
  const pre = Array.from({ length: n }, () => 2_000_000_000);
  const post = [...pre];
  post[0] = pre[0] + Number(effect.sol);
  const t = effect.token;
  const bal = (amount: bigint) => t && [{ accountIndex: 1, mint: t.mint, owner: t.owner, uiTokenAmount: { amount: amount.toString(), decimals: t.decimals, uiAmount: null, uiAmountString: "" } }];
  return {
    slot: 1,
    blockTime: 1,
    transaction: { message: tx.message, signatures: tx.signatures.map((s) => bs58.encode(s)) },
    meta: { err: null, fee, preBalances: pre, postBalances: post, preTokenBalances: t ? bal(t.pre) : [], postTokenBalances: t ? bal(t.post) : [], loadedAddresses: loaded, innerInstructions: [], logMessages: [] },
  } as unknown as VersionedTransactionResponse;
}

export const fastSend = { sleep: async () => undefined, pollMs: 0, rebroadcastMs: 0, timeoutMs: 50 };
