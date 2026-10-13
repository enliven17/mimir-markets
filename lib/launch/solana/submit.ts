// One path for every transaction a server wallet signs:
//   inspect (fee payer, signers, programs) -> fresh blockhash (unless the builder gave one with its
//   lastValidBlockHeight) -> extra local signers (e.g. the new mint) -> Privy signTransaction ->
//   verify message unchanged + all signatures valid -> our own broadcast/confirm -> confirmed tx.
// We sign via Privy and broadcast ourselves (instead of Privy signAndSendTransaction) so the signature
// is known BEFORE broadcast; that is what makes "did it land?" answerable and retries safe.
import { PublicKey, VersionedTransaction, type Connection, type Keypair, type VersionedTransactionResponse } from "@solana/web3.js";
import { ALLOWED_PROGRAMS, PROGRAMS, wsolAccount } from "./policy";
import type { Privy } from "./privy";
import { assertFullySigned, fetchConfirmedTx, inspectTx, lockedKeys, sendAndConfirm, signatureOf, type Rpc, type SendOptions, type StatusRpc } from "./tx";
import { lockedMintsOf } from "./locks";
import { resolveLookups } from "./alt";
import { AmbiguousSendError, SolanaError, TxFailedError } from "./util";

export type Conn = Rpc & Pick<Connection, "getAccountInfo" | "getBalance" | "getLatestBlockhash" | "simulateTransaction" | "getTokenAccountBalance" | "getAddressLookupTable">;

export type RetryEvent = { label: string; attempt: number; reason: string };

/** The endpoint one transaction lives on (lib/solana/rpc-pool stickyPool) and its history witnesses. */
export type Endpoints = { pickEndpoint(): { url: string; connection: Rpc & Pick<Connection, "getLatestBlockhash">; witnesses: readonly StatusRpc[] } | null };

export type SubmitDeps = {
  privy: Pick<Privy, "signTransaction">;
  connection: Conn;
  send?: SendOptions;
  maxAttempts?: number;
  onRetry?: (e: RetryEvent) => void;
  /** The wallet's own token(s), never sold or moved (default: the process lock registry, ./locks.ts). */
  lockedMints?: (wallet: string) => readonly string[] | Promise<readonly string[]>;
  /**
   * H1: where each transaction is sent. Absent = `connection` with no witness (tests; an expired tx
   * is then always "ambiguous", never rebuilt). Reads/simulations still use `connection`.
   */
  endpoints?: Endpoints;
};

export type Unsigned = {
  tx: VersionedTransaction;
  /** Ignored for sending (the pinned endpoint's blockhash always replaces the builder's); kept for callers. */
  lastValidBlockHeight?: number;
  extraSigners?: Keypair[];
  /** Explicit SOL recipient of this call (besides the wallet's own WSOL account). */
  transferTo?: string[];
  /** Most SOL (lamports) this tx may take out of the wallet, checked by simulation before signing. */
  maxSolOut?: bigint;
  /** A buy/claim/launch may reference the own mint in a swap program; the balance guard still applies. */
  allowLockedTouch?: boolean;
  /** Own token(s) of the wallet for this call (the agent record's mint), on top of SubmitDeps.lockedMints. */
  lockedMints?: readonly string[];
  /** Own-token raw units this tx may destroy (a burn of exactly this much). Default 0. */
  burnLocked?: bigint;
  /** M5: mints of open positions; the simulation refuses any drop in their balance. */
  protectMints?: readonly string[];
  /** M5: the one token this call may spend (a sell or burn) and how much of it, at most. */
  spend?: { mint: string; amount: bigint };
  /** M5: a sell must bring at least this many lamports back into the wallet (net of fees). */
  minSolIn?: bigint;
  /** A buy must bring at least this many raw units of `mint` into the wallet (the quote's minimum). */
  minTokensIn?: { mint: string; amount: bigint };
  /** Called with the signature after signing and verification, BEFORE the first broadcast (record it to resume safely). */
  onSigned?: (sig: string, lastValidBlockHeight: number) => Promise<void>;
};

/** Raw amount of an SPL token account (the u64 at byte 64 in Token and Token-2022). Missing/short = 0. */
function tokenAmount(data: Buffer | Uint8Array | null | undefined): bigint {
  if (!data || data.length < 72) return BigInt(0);
  return Buffer.from(data).readBigUInt64LE(64);
}

/** Fees-only ceiling for calls that should not spend SOL (sells, claims, burns). */
export const FEE_ONLY_LAMPORTS = BigInt(20_000_000);

const TX_PROGRAMS = [...ALLOWED_PROGRAMS, PROGRAMS.system];
const NEVER_RETRY = new Set(["BAD_INPUT", "CONFIG", "TX_REJECTED", "TX_TAMPERED", "TX_UNSIGNED", "INSUFFICIENT", "NO_BALANCE"]);

/** Re-tag an error raised BEFORE broadcast: nothing can have landed. */
function preBroadcast(err: unknown): SolanaError {
  if (err instanceof SolanaError) {
    if (err.notLanded) return err;
    // Privy 4xx (policy violation, bad request) will not change on retry; network/5xx may.
    const transient = err.status === null || err.status >= 500 || err.status === 429;
    const msg = err.message.replace(/^\w+: /, "");
    return new SolanaError(err.provider, msg, { status: err.status, code: transient ? err.code : (err.code ?? "REJECTED"), notLanded: true });
  }
  return new SolanaError("solana", err instanceof Error ? err.message : String(err), { notLanded: true });
}

export function isRetryable(err: unknown): boolean {
  if (!(err instanceof SolanaError) || err instanceof AmbiguousSendError || err instanceof TxFailedError) return false;
  if (!err.notLanded || (err.code && NEVER_RETRY.has(err.code)) || err.code === "REJECTED") return false;
  return !(err.status !== null && err.status >= 400 && err.status < 500 && err.status !== 429);
}

const guardFail = (why: string) => new SolanaError("solana", why, { code: "TX_REJECTED", notLanded: true });

/**
 * Second line of defence behind inspectTx: simulate, and refuse if the wallet would lose more SOL
 * than this call should ever spend, receive less than a sell's minimum (or a buy's minimum tokens),
 * or see any watched token balance drop beyond what the call declares. Catches drains through
 * instructions we cannot decode (CPIs, lookup-table accounts, a compromised builder).
 * Watched (M5): the own token(s) (may only drop by a declared burn), the open positions' tokens
 * (`protectMints`, may not drop), the traded mint (may drop by `spend.amount` only) and the bought mint.
 * Also used for user trades (lib/server/solana/executor.ts buildUserTrade), with the user's wallet.
 */
export async function simulationGuard(conn: Pick<Conn, "getBalance" | "simulateTransaction" | "getAccountInfo">, tx: VersionedTransaction, wallet: string, u: Omit<Unsigned, "tx">, locked: readonly string[]): Promise<void> {
  const burnLocked = u.burnLocked ?? BigInt(0);
  const watched = [...new Set([...locked, ...(u.protectMints ?? []), ...(u.spend ? [u.spend.mint] : []), ...(u.minTokensIn ? [u.minTokensIn.mint] : [])])];
  const atas = watched.flatMap((mint) => [...lockedKeys(wallet, [mint])].filter((k) => k !== mint).map((ata) => ({ mint, ata })));
  const [pre, sim, preTokens] = await Promise.all([
    conn.getBalance(new PublicKey(wallet), "confirmed"),
    conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { addresses: [wallet, ...atas.map((a) => a.ata)], encoding: "base64" } }),
    Promise.all(atas.map(async (a) => tokenAmount((await conn.getAccountInfo(new PublicKey(a.ata), "confirmed"))?.data))),
  ]);
  if (sim.value.err) throw guardFail(`simulation failed: ${JSON.stringify(sim.value.err).slice(0, 200)}`);
  const post = sim.value.accounts?.[0]?.lamports;
  if (post === undefined || post === null) throw guardFail("simulation returned no wallet balance");
  const out = BigInt(pre) - BigInt(post);
  const maxOut = u.maxSolOut ?? FEE_ONLY_LAMPORTS;
  if (out > maxOut) throw guardFail(`tx would take ${out} lamports out of the wallet, limit ${maxOut}`);
  if (u.minSolIn !== undefined && -out < u.minSolIn) throw guardFail(`sell would receive ${-out} lamports, minimum ${u.minSolIn}`);
  const drop = new Map<string, bigint>();
  atas.forEach((a, i) => {
    const acc = sim.value.accounts?.[i + 1];
    const after = acc ? tokenAmount(Buffer.from(acc.data[0], "base64")) : BigInt(0);
    drop.set(a.mint, (drop.get(a.mint) ?? BigInt(0)) + preTokens[i] - after);
  });
  for (const [mint, d0] of drop) {
    const isLocked = locked.includes(mint);
    const allowed = isLocked ? burnLocked : u.spend?.mint === mint ? u.spend.amount : BigInt(0);
    if (d0 > allowed) throw guardFail(isLocked ? `own token is locked: its balance would drop by ${d0}, declared burn ${allowed}` : `${mint} balance would drop by ${d0}, allowed ${allowed}`);
  }
  if (u.minTokensIn) {
    const gained = -(drop.get(u.minTokensIn.mint) ?? BigInt(0));
    if (gained < u.minTokensIn.amount) throw guardFail(`buy would receive ${gained} of ${u.minTokensIn.mint}, minimum ${u.minTokensIn.amount}`);
  }
}

export function createSubmitter(d: SubmitDeps) {
  const maxAttempts = d.maxAttempts ?? 3;

  const pick = () => (d.endpoints ? d.endpoints.pickEndpoint() : { url: "default", connection: d.connection, witnesses: [] });

  async function signAndConfirm(walletId: string, wallet: string, u: Unsigned): Promise<VersionedTransactionResponse> {
    let signed: VersionedTransaction;
    let lvbh: number;
    const ep = pick();
    try {
      if (!ep) throw new SolanaError("solana", "no RPC endpoint for sending: set HELIUS_API_KEYS or SOLANA_RPC (the public RPC is never used for money)", { code: "CONFIG" });
      const tx = u.tx;
      const extra = u.extraSigners ?? [];
      const locked = [...new Set([...(await (d.lockedMints ?? lockedMintsOf)(wallet)), ...(u.lockedMints ?? [])])];
      inspectTx(tx, {
        feePayer: wallet, allowedPrograms: TX_PROGRAMS, extraSigners: extra.map((k) => k.publicKey.toBase58()),
        allowedTransferTo: [wsolAccount(wallet), ...(u.transferTo ?? [])], lockedMints: locked, allowLockedTouch: u.allowLockedTouch,
        loaded: await resolveLookups(d.connection, tx),
      });
      // Always the pinned endpoint's blockhash: its lastValidBlockHeight is what that endpoint's
      // expiry check is measured against (a builder's blockhash may be from a node ahead of ours).
      const latest = await ep.connection.getLatestBlockhash("confirmed");
      tx.message.recentBlockhash = latest.blockhash;
      lvbh = latest.lastValidBlockHeight;
      await simulationGuard(d.connection, tx, wallet, u, locked);
      if (extra.length) tx.sign(extra);
      const message = tx.message.serialize();
      const out = await d.privy.signTransaction(walletId, Buffer.from(tx.serialize()).toString("base64"));
      signed = VersionedTransaction.deserialize(Buffer.from(out, "base64"));
      // Ed25519 is deterministic: re-applying our local signatures is a no-op if Privy preserved them.
      if (extra.length) signed.sign(extra);
      assertFullySigned(signed, message);
      await u.onSigned?.(signatureOf(signed), lvbh);
    } catch (err) {
      throw preBroadcast(err);
    }
    const sig = await sendAndConfirm(ep!.connection, signed, lvbh, { ...d.send, witnesses: ep!.witnesses });
    return fetchConfirmedTx(ep!.connection, sig, { sleep: d.send?.sleep });
  }

  /** Rebuilds and resends ONLY when the previous attempt provably did not land. */
  async function run<T>(label: string, build: () => Promise<{ walletId: string; wallet: string; unsigned: Unsigned }>, finish: (tx: VersionedTransactionResponse) => T): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        let job: Awaited<ReturnType<typeof build>>;
        try {
          job = await build();
        } catch (err) {
          throw preBroadcast(err);
        }
        return finish(await signAndConfirm(job.walletId, job.wallet, job.unsigned));
      } catch (err) {
        if (attempt >= maxAttempts || !isRetryable(err)) throw err;
        d.onRetry?.({ label, attempt, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return { signAndConfirm, run };
}

export type Submitter = ReturnType<typeof createSubmitter>;
