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
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  SOLANA_RPC,
  MAGICBLOCK_ER_RPC,
  ER_VALIDATOR,
  MIMIR_PROGRAM_ID,
  USDC_MINT,
  balancePda,
  claimPda,
  configPda,
  feeBalancePda,
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
 * (7 days by default). The claim must be on the base layer; if it is still
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

// ── V3 settlement: payout cranks, bond refund, withdraw (pull payments) ────

/** Create the recipient's USDC ATA when missing (the connected wallet pays rent). */
function ensureAtaIx(m: BrowserMimir, owner: PublicKey) {
  return createAssociatedTokenAccountIdempotentInstruction(m.owner, ata(owner), owner, USDC_MINT);
}

const NONE_KEY = PublicKey.default;
const hasKey = (k: string | null | undefined): k is string => Boolean(k && k !== NONE_KEY.toBase58());

/**
 * The agent-owner FeeBalance to pass when that leg owes an agent fee, opening
 * it first when needed. Null when no agent fee is due (the program then
 * requires the optional account to be absent).
 */
async function agentFeeAccount(
  m: BrowserMimir,
  agent: string | null | undefined,
  recipient: string,
  agentFeeBps: number,
  hasProfit: boolean
): Promise<PublicKey | null> {
  if (!hasKey(agent) || agent === recipient || agentFeeBps === 0 || !hasProfit) return null;
  const owner = new PublicKey(agent);
  const pda = feeBalancePda(owner);
  const info = await m.base.provider.connection.getAccountInfo(pda);
  if (!info) {
    await m.base.methods.openFeeAccount(owner).accounts({ payer: m.owner }).rpc();
  }
  return pda;
}

export interface PayoutLegInput {
  claimId: bigint;
  /** Base58 of who receives this leg. */
  recipient: string;
  /** Base58 agent owner credited on this leg ('' / null = none). */
  agent?: string | null;
  agentFeeBps: number;
  /** Gross above principal: an agent fee (and account) is only due then. */
  hasProfit: boolean;
}

/** Permissionless crank: pay the creator's leg of a RESOLVED claim to their USDC ATA. */
export async function payoutCreator(m: BrowserMimir, leg: PayoutLegInput): Promise<string> {
  const recipient = new PublicKey(leg.recipient);
  const agentFees = await agentFeeAccount(m, leg.agent, leg.recipient, leg.agentFeeBps, leg.hasProfit);
  return m.base.methods
    .payoutCreator()
    .accounts({ claim: claimPda(leg.claimId), creatorToken: ata(recipient), agentFees } as any)
    .preInstructions([ensureAtaIx(m, recipient)])
    .rpc();
}

/** Permissionless crank: pay challenger #index of a RESOLVED claim to their USDC ATA. */
export async function payoutChallenger(m: BrowserMimir, leg: PayoutLegInput & { index: number }): Promise<string> {
  const recipient = new PublicKey(leg.recipient);
  const agentFees = await agentFeeAccount(m, leg.agent, leg.recipient, leg.agentFeeBps, leg.hasProfit);
  return m.base.methods
    .payoutChallenger(leg.index)
    .accounts({ claim: claimPda(leg.claimId), challengerToken: ata(recipient), agentFees } as any)
    .preInstructions([ensureAtaIx(m, recipient)])
    .rpc();
}

/** Permissionless crank: return a refundable dispute bond to the disputer's ATA. */
export async function refundBond(m: BrowserMimir, claimId: bigint, disputer: string): Promise<string> {
  const owner = new PublicKey(disputer);
  return m.base.methods
    .refundBond()
    .accounts({ claim: claimPda(claimId), disputerToken: ata(owner) })
    .preInstructions([ensureAtaIx(m, owner)])
    .rpc();
}

/** Is this account currently owned by the delegation program (i.e. in the ER)? */
async function isDelegatedAccount(m: BrowserMimir, address: PublicKey): Promise<boolean> {
  const info = await m.base.provider.connection.getAccountInfo(address);
  return Boolean(info && !info.owner.equals(m.base.programId));
}

async function waitUntilOnBase(m: BrowserMimir, address: PublicKey, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (!(await isDelegatedAccount(m, address))) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** refund_expired, undelegating the claim from the ER first when it is still there. */
export async function refundExpiredFromAnywhere(m: BrowserMimir, claimId: bigint): Promise<string> {
  const pda = claimPda(claimId);
  if (await isDelegatedAccount(m, pda)) {
    await undelegateClaim(m, claimId);
    if (!(await waitUntilOnBase(m, pda))) throw new Error("The claim is still in the rollup. Try again in a minute.");
  }
  return refundExpired(m, claimId);
}

/**
 * Pull the whole free virtual balance back to the wallet: commit + undelegate
 * the balance from the ER when needed, then withdraw on the base layer.
 * Returns the withdrawn amount (base units) and the withdraw signature.
 */
export async function withdrawAllBalance(m: BrowserMimir): Promise<{ units: bigint; sig: string | null }> {
  const pda = balancePda(m.owner);
  if (await isDelegatedAccount(m, pda)) {
    await undelegateBalance(m);
    if (!(await waitUntilOnBase(m, pda))) throw new Error("Your balance is still in the rollup. Try again in a minute.");
  }
  const b: any = await (m.base.account as any).userBalance.fetchNullable(pda);
  const units = b ? BigInt(b.amount.toString()) : 0n;
  if (units === 0n) return { units, sig: null };
  const sig = await withdrawUsdc(m, units);
  return { units, sig };
}
