// Agent wallet operations besides trading: launch its token (as creator), claim pump.fun creator fees,
// burn tokens (buyback + burn), move SOL to an allow-listed address. Exposed through createExecutor.
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import type { Fill } from "../ports";
import type { PumpPortal, TokenMeta } from "./pumpportal";
import { validateMeta } from "./pumpportal";
import type { Conn, Submitter, Unsigned } from "./submit";
import { walletDeltas } from "./tx";
import { assertAddress, assertPositive, assertSlippageBps, SolanaError } from "./util";

const FEE_MARGIN_LAMPORTS = BigInt(20_000);
const SIMPLE_CU_LIMIT = 40_000;
const SIMPLE_CU_PRICE_MICROLAMPORTS = 50_000; // 40k CU x 0.05 lamports = 2,000 lamports priority fee
/** System transfers per tx: 20 (+ payer, System, ComputeBudget keys and two budget ixs) is ~1200 bytes, under the 1232 limit; 21 is not. */
const MAX_BATCH = 20;

type OpsDeps = {
  connection: Conn;
  pumpportal: PumpPortal;
  submitter: Submitter;
  mintInfo(mint: string): Promise<{ program: PublicKey; decimals: number }>;
  tokenBalance(wallet: string, mint: string, program: PublicKey): Promise<bigint>;
};

export type LaunchArgs = Omit<TokenMeta, "imageDataUrl"> & { walletId: string; wallet: string; imageDataUrl: string; devBuyLamports: bigint; slippageBps?: number };
export type LaunchResult = { mint: string; sig: string; metadataUri: string; devBuy: Fill | null };

export function createOps(d: OpsDeps) {
  /** Locally built tx: compute budget + ixs; blockhash is filled in by the submitter. */
  function local(wallet: string, ixs: TransactionInstruction[]): Unsigned {
    const message = new TransactionMessage({
      payerKey: new PublicKey(wallet),
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: SIMPLE_CU_LIMIT }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SIMPLE_CU_PRICE_MICROLAMPORTS }),
        ...ixs,
      ],
    }).compileToV0Message();
    return { tx: new VersionedTransaction(message) };
  }

  /** Creates the token with the agent wallet as creator/fee payer; the new mint keypair co-signs locally. */
  async function launchToken(a: LaunchArgs): Promise<LaunchResult> {
    const wallet = assertAddress("wallet", a.wallet);
    validateMeta(a);
    if (typeof a.devBuyLamports !== "bigint" || a.devBuyLamports < BigInt(0)) throw new SolanaError("solana", "devBuyLamports must be a bigint >= 0", { code: "BAD_INPUT" });
    const slippageBps = assertSlippageBps(a.slippageBps ?? 1000);
    const { metadataUri } = await d.pumpportal.uploadMetadata(a);
    const mintKp = Keypair.generate(); // same mint across retries: a landed create can never be repeated
    const mint = mintKp.publicKey.toBase58();
    return d.submitter.run(
      `launch ${a.symbol}`,
      async () => {
        const bytes = await d.pumpportal.buildCreateTx({ creator: wallet, mint, name: a.name, symbol: a.symbol, metadataUri, devBuyLamports: a.devBuyLamports, slippageBps });
        return { walletId: a.walletId, wallet, unsigned: { tx: VersionedTransaction.deserialize(bytes), extraSigners: [mintKp], maxSolOut: a.devBuyLamports + BigInt(60_000_000), allowLockedTouch: true } };
      },
      (tx) => {
        const delta = walletDeltas(tx, wallet, mint);
        const devBuy = delta.tokens > BigInt(0) && delta.decimals !== null ? { sig: delta.sig, lamports: -delta.lamports, tokens: delta.tokens, decimals: delta.decimals } : null;
        return { mint, sig: delta.sig, metadataUri, devBuy };
      },
    );
  }

  /** Claims all pump.fun creator fees (curve + PumpSwap). `lamports` is the net SOL gained after tx fees. */
  async function claimCreatorFees(a: { walletId: string; wallet: string; onSigned?: (sig: string, lastValidBlockHeight: number) => Promise<void> }): Promise<{ sig: string; lamports: bigint }> {
    const wallet = assertAddress("wallet", a.wallet);
    return d.submitter.run(
      "claim fees",
      // onSigned: the claim's sig is stored before broadcast, so a claim that lands after a timeout is still booked.
      async () => ({ walletId: a.walletId, wallet, unsigned: { tx: VersionedTransaction.deserialize(await d.pumpportal.buildCollectFeeTx({ wallet })), allowLockedTouch: true, onSigned: a.onSigned } }),
      (tx) => {
        const delta = walletDeltas(tx, wallet, null);
        return { sig: delta.sig, lamports: delta.lamports };
      },
    );
  }

  /** SPL BurnChecked from the wallet's ATA (Token or Token-2022, read from the mint). */
  async function burn(a: { walletId: string; wallet: string; mint: string; tokens: bigint }): Promise<string> {
    const wallet = assertAddress("wallet", a.wallet);
    const mint = assertAddress("mint", a.mint);
    const tokens = assertPositive("tokens", a.tokens);
    const { program, decimals } = await d.mintInfo(mint);
    if ((await d.tokenBalance(wallet, mint, program)) < tokens) throw new SolanaError("solana", "burn exceeds token balance", { code: "INSUFFICIENT" });
    const owner = new PublicKey(wallet);
    const mintKey = new PublicKey(mint);
    const ata = getAssociatedTokenAddressSync(mintKey, owner, false, program);
    const ix = createBurnCheckedInstruction(ata, mintKey, owner, tokens, decimals, [], program);
    return d.submitter.run(
      `burn ${mint}`,
      // burnLocked: burning is the one way the own token may leave the wallet.
      async () => ({ walletId: a.walletId, wallet, unsigned: { ...local(wallet, [ix]), burnLocked: tokens, spend: { mint, amount: tokens } } }),
      (tx) => tx.transaction.signatures[0],
    );
  }

  /** System transfer. The wallet policy only lets this reach allow-listed addresses. */
  async function transferSol(a: { walletId: string; wallet: string; to: string; lamports: bigint; onSigned?: (sig: string, lastValidBlockHeight: number) => Promise<void> }): Promise<string> {
    const wallet = assertAddress("wallet", a.wallet);
    const to = assertAddress("to", a.to);
    const lamports = assertPositive("lamports", a.lamports);
    if (to === wallet) throw new SolanaError("solana", "cannot transfer to self", { code: "BAD_INPUT" });
    const balance = BigInt(await d.connection.getBalance(new PublicKey(wallet), "confirmed"));
    if (lamports + FEE_MARGIN_LAMPORTS > balance) throw new SolanaError("solana", "transfer exceeds balance minus fees", { code: "INSUFFICIENT" });
    const ix = SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(to), lamports });
    return d.submitter.run(
      `transfer ${to}`,
      async () => ({ walletId: a.walletId, wallet, unsigned: { ...local(wallet, [ix]), transferTo: [to], maxSolOut: lamports + BigInt(1_000_000), onSigned: a.onSigned } }),
      (tx) => tx.transaction.signatures[0],
    );
  }

  /**
   * One tx of SOL transfers to distinct recipients (holder airdrop batches). Only these recipients
   * pass inspectTx, the simulation caps the SOL out at their sum, and `onSigned` gets the
   * signature before the first broadcast so the caller can record it and resume without paying twice.
   */
  async function payBatch(a: { walletId: string; wallet: string; transfers: { to: string; lamports: bigint }[]; onSigned: (sig: string, lastValidBlockHeight: number) => Promise<void> }): Promise<string> {
    const wallet = assertAddress("wallet", a.wallet);
    if (a.transfers.length === 0 || a.transfers.length > MAX_BATCH) throw new SolanaError("solana", `a batch has 1 to at most ${MAX_BATCH} transfers`, { code: "BAD_INPUT" });
    const seen = new Set<string>();
    let total = BigInt(0);
    for (const t of a.transfers) {
      const to = assertAddress("to", t.to);
      assertPositive("lamports", t.lamports);
      if (to === wallet) throw new SolanaError("solana", "cannot transfer to self", { code: "BAD_INPUT" });
      if (seen.has(to)) throw new SolanaError("solana", `${to} appears twice in one batch`, { code: "BAD_INPUT" });
      seen.add(to);
      total += t.lamports;
    }
    const balance = BigInt(await d.connection.getBalance(new PublicKey(wallet), "confirmed"));
    if (total + FEE_MARGIN_LAMPORTS > balance) throw new SolanaError("solana", "batch exceeds balance minus fees", { code: "INSUFFICIENT" });
    const from = new PublicKey(wallet);
    const ixs = a.transfers.map((t) => SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(t.to), lamports: t.lamports }));
    return d.submitter.run(
      `airdrop batch of ${a.transfers.length}`,
      async () => ({ walletId: a.walletId, wallet, unsigned: { ...local(wallet, ixs), transferTo: [...seen], maxSolOut: total + BigInt(1_000_000), onSigned: a.onSigned } }),
      (tx) => tx.transaction.signatures[0],
    );
  }

  return { launchToken, claimCreatorFees, burn, transferSol, payBatch };
}
