"use client";

/**
 * Browser-side Mimir program access driven by a wallet-adapter wallet.
 * Mirrors MimirSolanaClient (lib/solana/client.ts) but signs through the
 * connected wallet instead of a Keypair.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  SOLANA_RPC,
  MAGICBLOCK_ER_RPC,
  ER_VALIDATOR,
  MIMIR_PROGRAM_ID,
  USDC_MINT,
  balancePda,
  claimPda,
  configPda,
} from "./config";
import idl from "./idl/mimir.json";

export interface CreateClaimInput {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  stakeAmount: bigint;
  deadline: number;
  maxChallengers?: number;
  /** Owner of the agent opening the position (earns the agent fee on profit). */
  agent?: PublicKey | null;
}

export interface BrowserMimir {
  base: Program;
  er: Program;
  owner: PublicKey;
}

const bn = (v: bigint | number) => new BN(v.toString());
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, owner, true);

export function createBrowserMimir(wallet: WalletContextState): BrowserMimir | null {
  if (!wallet.publicKey || !wallet.signTransaction) return null;
  const anchorWallet = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction as any,
    signAllTransactions: (wallet.signAllTransactions ?? (async (txs: any[]) => {
      const out = [] as any[];
      for (const tx of txs) out.push(await wallet.signTransaction!(tx));
      return out;
    })) as any,
  };
  const baseProvider = new AnchorProvider(
    new Connection(SOLANA_RPC, "confirmed"),
    anchorWallet as any,
    { commitment: "confirmed" }
  );
  const erProvider = new AnchorProvider(
    new Connection(MAGICBLOCK_ER_RPC, "confirmed"),
    anchorWallet as any,
    { commitment: "confirmed" }
  );
  const programIdl = { ...(idl as anchor.Idl), address: MIMIR_PROGRAM_ID.toBase58() };
  return {
    base: new Program(programIdl, baseProvider),
    er: new Program(programIdl, erProvider),
    owner: wallet.publicKey,
  };
}

/** USDC deposit into the Mimir vault (base layer). */
export async function depositUsdc(m: BrowserMimir, units: bigint): Promise<string> {
  return m.base.methods
    .deposit(bn(units))
    .accounts({ user: m.owner, userToken: ata(m.owner) })
    .rpc();
}

/**
 * Withdraw free virtual balance back to the wallet's USDC ATA (base layer).
 * The balance must be undelegated first (see undelegateBalance). Never paused.
 */
export async function withdrawUsdc(m: BrowserMimir, units: bigint): Promise<string> {
  return m.base.methods
    .withdraw(bn(units))
    .accounts({ user: m.owner, owner: m.owner, userToken: ata(m.owner) })
    .rpc();
}

/** Delegate the user's balance PDA to the MagicBlock ER. */
export async function delegateBalance(m: BrowserMimir): Promise<string> {
  return m.base.methods
    .delegateBalance()
    .accounts({ payer: m.owner, balance: balancePda(m.owner) })
    .remainingAccounts([
      { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
    ])
    .rpc();
}

/** Commit + hand the user's balance back to the base layer (needed before withdraw). */
export async function undelegateBalance(m: BrowserMimir): Promise<string> {
  return m.er.methods
    .undelegateBalance()
    .accounts({ payer: m.owner, balance: balancePda(m.owner) })
    .rpc({ skipPreflight: true });
}

/** Zero-fee, real-time challenge inside the Ephemeral Rollup. */
export async function challengeInER(
  m: BrowserMimir,
  claimId: bigint,
  units: bigint,
  agent: PublicKey | null = null
): Promise<string> {
  return m.er.methods
    .challengeClaim(bn(units), agent)
    .accounts({
      challenger: m.owner,
      claim: claimPda(claimId),
      balance: balancePda(m.owner),
    })
    .rpc({ skipPreflight: true });
}

/** Create a new claim (base layer). Returns the new claim ID and tx signature. */
export async function createClaim(
  m: BrowserMimir,
  input: CreateClaimInput
): Promise<{ claimId: bigint; txSig: string }> {
  const cfg: any = await (m.base.account as any).config.fetch(configPda());
  const nextId = BigInt(cfg.claimCount.toString()) + 1n;
  const txSig = await m.base.methods
    .createClaim({
      question: input.question,
      creatorPosition: input.creatorPosition,
      counterPosition: input.counterPosition,
      resolutionUrl: input.resolutionUrl,
      category: input.category,
      stakeAmount: bn(input.stakeAmount),
      deadline: bn(input.deadline),
      maxChallengers: input.maxChallengers ?? 16,
      agent: input.agent ?? null,
    })
    .accounts({
      creator: m.owner,
      claim: claimPda(nextId),
      creatorToken: ata(m.owner),
    })
    .rpc();
  return { claimId: nextId, txSig };
}

/** Delegate a claim PDA to the MagicBlock ER. */
export async function delegateClaim(
  m: BrowserMimir,
  claimId: bigint
): Promise<string> {
  return m.base.methods
    .delegateClaim(bn(claimId))
    .accounts({ payer: m.owner, claim: claimPda(claimId) })
    .remainingAccounts([
      { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
    ])
    .rpc();
}

/**
 * Dispute a PROPOSED verdict (participants only, before `disputableUntil`).
 * Posts a 2 USDC bond from the wallet's USDC ATA: returned if the arbiter
 * changes the verdict, forfeited to the platform otherwise.
 */
export async function disputeResolution(m: BrowserMimir, claimId: bigint): Promise<string> {
  return m.base.methods
    .disputeResolution()
    .accounts({ disputer: m.owner, claim: claimPda(claimId), disputerToken: ata(m.owner) })
    .rpc();
}

/** Anyone can finalize an undisputed proposal once its dispute window closed. */
export async function finalizeResolution(m: BrowserMimir, claimId: bigint): Promise<string> {
  return m.base.methods.finalizeResolution().accounts({ claim: claimPda(claimId) }).rpc();
}

/**
 * Escape hatch: refund an unresolved claim after deadline + resolution grace
 * (7 days by default). The claim must be on the base layer — if it is still
 * delegated, undelegateClaim first. Stakes then come back via the payout cranks.
 */
export async function refundExpired(m: BrowserMimir, claimId: bigint): Promise<string> {
  return m.base.methods.refundExpired().accounts({ caller: m.owner, claim: claimPda(claimId) }).rpc();
}

/** Commit + undelegate a claim from the ER (permissionless). */
export async function undelegateClaim(m: BrowserMimir, claimId: bigint): Promise<string> {
  return m.er.methods
    .undelegateClaim()
    .accounts({ payer: m.owner, claim: claimPda(claimId) })
    .rpc({ skipPreflight: true });
}

/** Virtual balance lookup (tries ER first, then base). */
export async function getVirtualBalance(m: BrowserMimir): Promise<bigint> {
  for (const program of [m.er, m.base]) {
    try {
      const b: any = await (program.account as any).userBalance.fetch(balancePda(m.owner));
      return BigInt(b.amount.toString());
    } catch {
      // not on this layer
    }
  }
  return 0n;
}
