// Transaction plumbing: inspect before signing, verify signatures after Privy, broadcast + confirm
// with a PROVABLE "not landed" answer, and measure fills from the confirmed transaction (never quotes).
//
// Docs: https://solana.com/docs/rpc/http/getsignaturestatuses, https://solana.com/docs/rpc/http/gettransaction,
//       https://solana.com/docs/rpc/http/sendtransaction (preflight failures are not forwarded),
//       https://solana.com/docs/advanced/confirmation (a tx can only land while block height <= lastValidBlockHeight).
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { PublicKey, VersionedTransaction, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { AmbiguousSendError, SolanaError, sleep, TxFailedError } from "./util";
import type { Fill } from "../ports";
import type { Loaded } from "./alt";

export const WSOL = "So11111111111111111111111111111111111111112";
export type Rpc = Pick<Connection, "sendRawTransaction" | "getSignatureStatuses" | "getBlockHeight" | "getTransaction">;

const SYSTEM = "11111111111111111111111111111111";
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/**
 * SPL Token / Token-2022 instructions a wallet may sign at top level. Everything else is refused:
 * Transfer(3), Approve(4), SetAuthority(6), TransferChecked(12), ApproveChecked(13), the Token-2022
 * extension families (TransferCheckedWithFee etc.) and anything unknown.
 *   0/20 InitializeMint(2), 1/16/18 InitializeAccount(2/3), 5 Revoke, 8/15 Burn(Checked),
 *   9 CloseAccount (destination must be the wallet itself), 17 SyncNative, 21 GetAccountDataSize,
 *   22 InitializeImmutableOwner
 */
const TOKEN_ALLOWED = new Set([0, 1, 5, 8, 9, 15, 16, 17, 18, 20, 21, 22]);
const CLOSE_ACCOUNT = 9;
const SYSTEM_TRANSFER = 2;

const rejected = (why: string) => new SolanaError("solana", why, { code: "TX_REJECTED", notLanded: true });

/**
 * Refuses transactions from third-party builders that we would not want to sign. Programs are
 * allow-listed, and System/Token instructions are decoded: SOL may only move to `allowedTransferTo`
 * (the wallet's own WSOL account plus the call's explicit recipient), token accounts may only be
 * closed back to the wallet, and approvals/authority changes/direct token transfers never pass.
 * Accounts loaded from address lookup tables are checked like static ones: the caller resolves them
 * from chain (./alt.ts resolveLookups) and passes them as `loaded`; a tx with lookups is refused
 * without them. Program ids can never come from a table (the runtime requires them static).
 */
export type InspectOptions = {
  feePayer: string;
  allowedPrograms: readonly string[];
  extraSigners?: string[];
  allowedTransferTo?: readonly string[];
  /** The wallet's own token(s): never sold or moved. Only Burn/BurnChecked may touch them. */
  lockedMints?: readonly string[];
  /** A buy/claim/launch may reference the own mint in a swap program (the simulation guard still refuses any decrease). */
  allowLockedTouch?: boolean;
  /** Accounts the tx loads from lookup tables, resolved from chain (required when it has lookups). */
  loaded?: Loaded;
};

/** The mint itself plus the owner's ATA under both token programs. */
export function lockedKeys(owner: string, mints: readonly string[]): Set<string> {
  const out = new Set<string>();
  const o = new PublicKey(owner);
  for (const m of mints) {
    const mint = new PublicKey(m);
    out.add(m);
    for (const p of TOKEN_PROGRAMS) out.add(getAssociatedTokenAddressSync(mint, o, false, new PublicKey(p)).toBase58());
  }
  return out;
}

const BURN = new Set([8, 15]);

export function inspectTx(tx: VersionedTransaction, o: InspectOptions): void {
  const m = tx.message;
  const staticKeys = m.staticAccountKeys.map((k) => k.toBase58());
  const lookups = m.addressTableLookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
  const loaded = o.loaded ?? { writable: [], readonly: [] };
  if (lookups !== loaded.writable.length + loaded.readonly.length) throw rejected("address lookup tables were not resolved: refusing accounts that cannot be checked");
  // Runtime order: static keys, then every table's writable addresses, then every table's readonly ones.
  const keys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const signers = staticKeys.slice(0, m.header.numRequiredSignatures);
  const expected = [o.feePayer, ...(o.extraSigners ?? [])];
  if (signers.length !== expected.length || signers.some((s, i) => s !== expected[i])) {
    throw rejected(`unexpected signers [${signers.join(",")}]`);
  }
  const allowedTo = new Set(o.allowedTransferTo ?? []);
  const locked = o.lockedMints?.length ? lockedKeys(o.feePayer, o.lockedMints) : null;
  for (const ix of m.compiledInstructions) {
    const program = ix.programIdIndex < staticKeys.length ? staticKeys[ix.programIdIndex] : undefined;
    if (!program || !o.allowedPrograms.includes(program)) throw rejected(`transaction calls non-allowed program ${program ?? "(lookup)"}`);
    const account = (i: number) => {
      const idx = ix.accountKeyIndexes[i];
      return idx !== undefined && idx < keys.length ? keys[idx] : null;
    };
    const data = ix.data;
    if (locked && ix.accountKeyIndexes.some((idx) => idx < keys.length && locked.has(keys[idx]))) {
      const isToken = TOKEN_PROGRAMS.includes(program);
      if (isToken ? !BURN.has(data.length ? data[0] : -1) : program !== ASSOCIATED_TOKEN && program !== COMPUTE_BUDGET && !o.allowLockedTouch) {
        throw rejected("the agent's own token is locked: it can only be burned, never sold or moved");
      }
    }
    if (program === SYSTEM) {
      const kind = data.length >= 4 ? data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24) : -1;
      if (kind !== SYSTEM_TRANSFER) throw rejected(`system instruction ${kind} is not allowed`);
      const to = account(1);
      if (!to || !allowedTo.has(to)) throw rejected(`SOL transfer to ${to ?? "(lookup)"} is not allowed`);
    } else if (TOKEN_PROGRAMS.includes(program)) {
      const kind = data.length ? data[0] : -1;
      if (!TOKEN_ALLOWED.has(kind)) throw rejected(`token instruction ${kind} is not allowed`);
      if (kind === CLOSE_ACCOUNT && account(1) !== o.feePayer) throw rejected("token account may only be closed back to the wallet");
    }
  }
}

function ed25519Valid(pubkey: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  if (sig.every((b) => b === 0)) return false;
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pubkey).toString("base64url") }, format: "jwk" });
  return cryptoVerify(null, msg, key, sig);
}

/** Every required signature present and valid over the exact message we built. */
export function assertFullySigned(tx: VersionedTransaction, expectedMessage: Uint8Array): void {
  const msg = tx.message.serialize();
  if (Buffer.compare(Buffer.from(msg), Buffer.from(expectedMessage)) !== 0) {
    throw new SolanaError("solana", "signer changed the transaction message", { code: "TX_TAMPERED", notLanded: true });
  }
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  signers.forEach((k, i) => {
    if (!tx.signatures[i] || !ed25519Valid(k.toBytes(), msg, tx.signatures[i])) {
      throw new SolanaError("solana", `missing/invalid signature for ${k.toBase58()}`, { code: "TX_UNSIGNED", notLanded: true });
    }
  });
}

export const signatureOf = (tx: VersionedTransaction) => bs58.encode(tx.signatures[0]);

export type SendOptions = {
  timeoutMs?: number; pollMs?: number; rebroadcastMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>;
  /** Other keyed endpoints, asked for history only (never sent to) before "not landed" is declared. */
  witnesses?: readonly StatusRpc[];
  /** Blocks past lastValidBlockHeight before an endpoint's "unknown" may count (default EXPIRY_MARGIN). */
  expiryMargin?: number;
};

export type StatusRpc = Pick<Connection, "getSignatureStatuses" | "getBlockHeight">;
/** Finalized blocks past lastValidBlockHeight before a missing signature may count as expired. */
export const EXPIRY_MARGIN = 150;
export type Settlement = "landed" | "failed" | "pending" | "notLanded" | "unknown";

type Status = { err: unknown; confirmationStatus?: string | null } | null | undefined;
const classify = (s: NonNullable<Status>): Settlement => (s.err ? "failed" : s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "landed" : "pending");

async function lookup(rpc: StatusRpc, sig: string): Promise<{ answered: boolean; status: Status }> {
  const st = await rpc.getSignatureStatuses([sig], { searchTransactionHistory: true }).catch(() => null);
  return st ? { answered: true, status: st.value[0] } : { answered: false, status: null };
}

async function pastExpiry(rpc: StatusRpc, lastValidBlockHeight: number, margin: number): Promise<boolean> {
  const h = await rpc.getBlockHeight("finalized").catch(() => null);
  return h !== null && h > lastValidBlockHeight + margin;
}

/**
 * Where a signature stands, with the H1 rule: "notLanded" ONLY when the primary endpoint has no record
 * of it and its own finalized height is past lastValidBlockHeight + margin, AND a second endpoint
 * (also past that height) has no record either. Anything short of that is "unknown" (never re-pay).
 */
export async function settleSignature(primary: StatusRpc, witnesses: readonly StatusRpc[], sig: string, lastValidBlockHeight: number, margin = EXPIRY_MARGIN): Promise<{ state: Settlement; err?: unknown }> {
  const p = await lookup(primary, sig);
  if (p.status) return { state: classify(p.status), err: p.status.err ?? undefined };
  if (!p.answered || !(await pastExpiry(primary, lastValidBlockHeight, margin))) return { state: "unknown" };
  for (const w of witnesses) {
    const x = await lookup(w, sig);
    if (x.status) return { state: classify(x.status), err: x.status.err ?? undefined };
    if (x.answered && (await pastExpiry(w, lastValidBlockHeight, margin))) return { state: "notLanded" };
  }
  return { state: "unknown" };
}

/**
 * Broadcasts the SAME signed bytes until confirmed or provably expired. Re-sending identical bytes can
 * never double-execute (one signature lands at most once). Resolves with the sig when confirmed.
 * `rpc` must be ONE endpoint (rpc-pool pickEndpoint): sends, polling and the expiry check stay on it.
 * Throws: SolanaError{notLanded} (the first send's preflight was rejected, or settleSignature proved
 * it expired on two endpoints: safe to rebuild), TxFailedError (landed with an error),
 * AmbiguousSendError (could not decide: never resend, reconcile by signature).
 */
export async function sendAndConfirm(rpc: Rpc, signed: VersionedTransaction, lastValidBlockHeight: number, o: SendOptions = {}): Promise<string> {
  const sig = signatureOf(signed);
  const raw = signed.serialize();
  const now = o.now ?? Date.now;
  const wait = o.sleep ?? sleep;
  const deadline = now() + (o.timeoutMs ?? 200_000);
  const margin = o.expiryMargin ?? EXPIRY_MARGIN;
  try {
    await rpc.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
  } catch (err) {
    // Only the FIRST send, on the pinned endpoint, can prove "not forwarded": a failed preflight is
    // never forwarded. Anything else (timeout, 5xx, socket reset, "already processed") may have been:
    // fall through and confirm the same bytes. Every later send error is ignored (ambiguous).
    const text = err instanceof Error ? err.message : String(err);
    if (/simulation failed|blockhash not found/i.test(text)) throw new SolanaError("solana", `preflight rejected: ${text.slice(0, 300)}`, { notLanded: true });
  }
  let lastSend = now();
  while (now() < deadline) {
    const st = await rpc.getSignatureStatuses([sig], { searchTransactionHistory: false }).catch(() => null);
    const s = st?.value[0];
    if (s?.err) throw new TxFailedError(sig, s.err);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return sig;
    if (!s && (await pastExpiry(rpc, lastValidBlockHeight, margin))) {
      const r = await settleSignature(rpc, o.witnesses ?? [], sig, lastValidBlockHeight, margin);
      if (r.state === "landed") return sig;
      if (r.state === "failed") throw new TxFailedError(sig, r.err);
      if (r.state === "notLanded") throw new SolanaError("solana", `blockhash expired, ${sig} never landed (checked on two endpoints)`, { code: "EXPIRED", notLanded: true });
      if (!o.witnesses?.length) throw new AmbiguousSendError(sig, "blockhash expired but no second endpoint can confirm it never landed");
    } else if (now() - lastSend >= (o.rebroadcastMs ?? 2_000)) {
      lastSend = now();
      await rpc.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
    }
    await wait(o.pollMs ?? 1_000);
  }
  throw new AmbiguousSendError(sig, "confirmation timed out");
}

type TokenBalance = NonNullable<NonNullable<VersionedTransactionResponse["meta"]>["postTokenBalances"]>[number];

function tokenTotal(list: TokenBalance[] | null | undefined, owner: string, mint: string): { raw: bigint; decimals: number | null } {
  let raw = BigInt(0);
  let decimals: number | null = null;
  for (const b of list ?? []) {
    if (b.owner !== owner || b.mint !== mint) continue;
    raw += BigInt(b.uiTokenAmount.amount);
    decimals = b.uiTokenAmount.decimals;
  }
  return { raw, decimals };
}

export type Deltas = { sig: string; lamports: bigint; tokens: bigint; decimals: number | null; fee: bigint };

/**
 * Net balance changes of `wallet` in a confirmed tx. `lamports` = SOL change INCLUDING the network fee,
 * priority fee, rent and wrapped SOL (WSOL token change counts as SOL). `tokens` = change of `mint`.
 */
export function walletDeltas(tx: VersionedTransactionResponse, wallet: string, mint: string | null): Deltas {
  const meta = tx.meta;
  if (!meta) throw new SolanaError("solana", "transaction has no meta", { code: "NO_META" });
  const sig = tx.transaction.signatures[0];
  if (meta.err) throw new TxFailedError(sig, meta.err);
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses });
  let idx = -1;
  for (let i = 0; i < keys.length; i++) if (keys.get(i)?.toBase58() === wallet) idx = i;
  if (idx < 0) throw new SolanaError("solana", `wallet ${wallet} is not in transaction ${sig}`, { code: "NOT_IN_TX" });
  const sol = BigInt(meta.postBalances[idx]) - BigInt(meta.preBalances[idx]);
  const wsol = tokenTotal(meta.postTokenBalances, wallet, WSOL).raw - tokenTotal(meta.preTokenBalances, wallet, WSOL).raw;
  const post = mint ? tokenTotal(meta.postTokenBalances, wallet, mint) : { raw: BigInt(0), decimals: null };
  const pre = mint ? tokenTotal(meta.preTokenBalances, wallet, mint) : { raw: BigInt(0), decimals: null };
  return { sig, lamports: sol + wsol, tokens: post.raw - pre.raw, decimals: post.decimals ?? pre.decimals, fee: BigInt(meta.fee) };
}

/** Buy fill: SOL spent (positive) and tokens received; sell fill: SOL received (net of fees) and tokens sold. */
export function fillFrom(d: Deltas, side: "buy" | "sell"): Fill {
  if (d.decimals === null) throw new SolanaError("solana", `no token balance change in ${d.sig}`, { code: "NO_FILL" });
  return side === "buy"
    ? { sig: d.sig, lamports: -d.lamports, tokens: d.tokens, decimals: d.decimals }
    : { sig: d.sig, lamports: d.lamports, tokens: -d.tokens, decimals: d.decimals };
}

export async function fetchConfirmedTx(rpc: Rpc, sig: string, o: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<VersionedTransactionResponse> {
  for (let i = 0; i < (o.attempts ?? 10); i++) {
    const tx = await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (tx) return tx;
    await (o.sleep ?? sleep)(1_000);
  }
  throw new AmbiguousSendError(sig, "confirmed but getTransaction returned nothing");
}
