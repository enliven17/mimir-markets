/**
 * MimirSolanaClient — high-level client for the Mimir program.
 *
 * Two connections:
 *  - base:  Solana devnet (deposits, claim creation, resolution, payouts)
 *  - er:    MagicBlock Ephemeral Rollup (zero-fee, ~30ms challenges)
 *
 * The same Anchor IDL drives both; only the provider differs. Delegated
 * accounts (claim + user balance PDAs) live in the ER until the oracle
 * commits + undelegates them at settlement time.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Connection,
  type FetchMiddleware,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  SOLANA_RPC,
  MAGICBLOCK_ER_RPC,
  MAGICBLOCK_ER_WS,
  ER_VALIDATOR,
  USDC_MINT,
  balancePda,
  claimPda,
  configPda,
  vaultPda,
} from "./config";
import idl from "./idl/mimir.json";

export interface CreateClaimInput {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  stakeAmount: bigint; // 6dp units
  deadline: number; // unix seconds
  maxChallengers?: number;
}

export interface OnchainClaim {
  id: bigint;
  creator: PublicKey;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  creatorStake: bigint;
  totalChallengerStake: bigint;
  deadline: number;
  state: number;
  winnerSide: number;
  resolutionSummary: string;
  confidence: number;
  evidenceHash: Uint8Array;
  createdAt: number;
  maxChallengers: number;
  creatorPaid: boolean;
  challengers: { addr: PublicKey; stake: bigint; paid: boolean }[];
}

/**
 * Minimal Keypair wallet implementing anchor's Wallet interface.
 * anchor's own NodeWallet isn't exported from the ESM build, which breaks
 * Next.js (Turbopack) bundling of server routes that import this module.
 */
export class KeypairWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("partialSign" in tx) tx.partialSign(this.payer);
    else tx.sign([this.payer]);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

/**
 * web3.js sets no timeout on JSON-RPC calls, so a stalled RPC node would hang
 * an API route or a worker poll indefinitely. Every request gets a deadline.
 */
const RPC_TIMEOUT_MS = Number(process.env.SOLANA_RPC_TIMEOUT_MS ?? "20000");
const rpcTimeoutMiddleware: FetchMiddleware = (info, init, next) => {
  next(info, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) } as typeof init);
};

export class MimirSolanaClient {
  readonly base: Program;
  readonly er: Program;
  readonly baseConnection: Connection;
  readonly erConnection: Connection;
  readonly wallet: KeypairWallet;

  constructor(signer: Keypair) {
    this.wallet = new KeypairWallet(signer);
    this.baseConnection = new Connection(SOLANA_RPC, {
      commitment: "confirmed",
      fetchMiddleware: rpcTimeoutMiddleware,
    });
    this.erConnection = new Connection(MAGICBLOCK_ER_RPC, {
      wsEndpoint: MAGICBLOCK_ER_WS,
      commitment: "confirmed",
      fetchMiddleware: rpcTimeoutMiddleware,
    });
    const baseProvider = new AnchorProvider(this.baseConnection, this.wallet, {
      commitment: "confirmed",
    });
    const erProvider = new AnchorProvider(this.erConnection, this.wallet, {
      commitment: "confirmed",
    });
    this.base = new Program(idl as anchor.Idl, baseProvider);
    this.er = new Program(idl as anchor.Idl, erProvider);
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  usdcAta(owner: PublicKey = this.publicKey): PublicKey {
    return getAssociatedTokenAddressSync(USDC_MINT, owner, true);
  }

  // ── Base layer ────────────────────────────────────────────────────────

  async initialize(oracle: PublicKey): Promise<string> {
    return this.base.methods
      .initialize(oracle)
      .accounts({
        admin: this.publicKey,
        usdcMint: USDC_MINT,
      })
      .rpc();
  }

  async deposit(amount: bigint): Promise<string> {
    return this.base.methods
      .deposit(new BN(amount.toString()))
      .accounts({
        user: this.publicKey,
        userToken: this.usdcAta(),
      })
      .rpc();
  }

  async withdraw(amount: bigint): Promise<string> {
    return this.base.methods
      .withdraw(new BN(amount.toString()))
      .accounts({
        user: this.publicKey,
        owner: this.publicKey,
        userToken: this.usdcAta(),
      })
      .rpc();
  }

  async createClaim(input: CreateClaimInput): Promise<{
    txSig: string;
    claimId: bigint;
    claimAddress: PublicKey;
  }> {
    const cfg: any = await (this.base.account as any).config.fetch(configPda());
    const nextId = BigInt(cfg.claimCount.toString()) + 1n;
    const txSig = await this.base.methods
      .createClaim({
        question: input.question,
        creatorPosition: input.creatorPosition,
        counterPosition: input.counterPosition,
        resolutionUrl: input.resolutionUrl,
        category: input.category,
        stakeAmount: new BN(input.stakeAmount.toString()),
        deadline: new BN(input.deadline),
        maxChallengers: input.maxChallengers ?? 0,
      })
      .accounts({
        creator: this.publicKey,
        claim: claimPda(nextId),
        creatorToken: this.usdcAta(),
      })
      .rpc();
    return { txSig, claimId: nextId, claimAddress: claimPda(nextId) };
  }

  async cancelClaim(claimId: bigint): Promise<string> {
    return this.base.methods
      .cancelClaim()
      .accounts({
        creator: this.publicKey,
        claim: claimPda(claimId),
        creatorToken: this.usdcAta(),
      })
      .rpc();
  }

  async resolveClaim(
    claimId: bigint,
    winnerSide: number,
    summary: string,
    confidence: number,
    evidenceHash: Uint8Array
  ): Promise<string> {
    return this.base.methods
      .resolveClaim(winnerSide, summary, confidence, Array.from(evidenceHash))
      .accounts({
        oracle: this.publicKey,
        claim: claimPda(claimId),
      })
      .rpc();
  }

  async payoutCreator(claimId: bigint, creator: PublicKey): Promise<string> {
    return this.base.methods
      .payoutCreator()
      .accounts({
        claim: claimPda(claimId),
        creatorToken: this.usdcAta(creator),
      })
      .rpc();
  }

  async payoutChallenger(
    claimId: bigint,
    index: number,
    challenger: PublicKey
  ): Promise<string> {
    return this.base.methods
      .payoutChallenger(index)
      .accounts({
        claim: claimPda(claimId),
        challengerToken: this.usdcAta(challenger),
      })
      .rpc();
  }

  // ── MagicBlock ER: delegation ─────────────────────────────────────────

  async delegateClaim(claimId: bigint): Promise<string> {
    return this.base.methods
      .delegateClaim(new BN(claimId.toString()))
      .accounts({
        payer: this.publicKey,
        claim: claimPda(claimId),
      })
      .remainingAccounts([
        { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
      ])
      .rpc();
  }

  async delegateBalance(): Promise<string> {
    return this.base.methods
      .delegateBalance()
      .accounts({
        payer: this.publicKey,
        balance: balancePda(this.publicKey),
      })
      .remainingAccounts([
        { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
      ])
      .rpc();
  }

  /** Runs inside the Ephemeral Rollup — zero fee, ~30ms */
  async challengeClaimER(claimId: bigint, stake: bigint): Promise<string> {
    return this.er.methods
      .challengeClaim(new BN(stake.toString()))
      .accounts({
        challenger: this.publicKey,
        claim: claimPda(claimId),
        balance: balancePda(this.publicKey),
      })
      .rpc({ skipPreflight: true });
  }

  /** Same instruction, base layer (pre-delegation fallback) */
  async challengeClaimBase(claimId: bigint, stake: bigint): Promise<string> {
    return this.base.methods
      .challengeClaim(new BN(stake.toString()))
      .accounts({
        challenger: this.publicKey,
        claim: claimPda(claimId),
        balance: balancePda(this.publicKey),
      })
      .rpc();
  }

  /** Commit ER state and hand the claim back to the base layer */
  async undelegateClaim(claimId: bigint): Promise<string> {
    return this.er.methods
      .undelegateClaim()
      .accounts({
        payer: this.publicKey,
        claim: claimPda(claimId),
      })
      .rpc({ skipPreflight: true });
  }

  async undelegateBalance(): Promise<string> {
    return this.er.methods
      .undelegateBalance()
      .accounts({
        payer: this.publicKey,
        balance: balancePda(this.publicKey),
      })
      .rpc({ skipPreflight: true });
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  /** Read a claim from whichever layer currently owns it. */
  async getClaim(claimId: bigint): Promise<OnchainClaim | null> {
    const address = claimPda(claimId);
    // Try ER first (delegated claims live there), then base.
    for (const program of [this.er, this.base]) {
      try {
        const c: any = await (program.account as any).claim.fetch(address);
        return normalizeClaim(c);
      } catch {
        // not on this layer
      }
    }
    return null;
  }

  /**
   * The claim as the base layer holds it, ignoring any ER copy. Use it for a
   * check right before a base-layer write: after undelegation the ER can still
   * serve a stale snapshot. Null when absent; throws on RPC failure.
   */
  async getBaseClaim(claimId: bigint): Promise<OnchainClaim | null> {
    const c: any = await (this.base.account as any).claim.fetchNullable(claimPda(claimId));
    return c ? normalizeClaim(c) : null;
  }

  async getConfig(): Promise<{
    admin: PublicKey;
    oracle: PublicKey;
    usdcMint: PublicKey;
    claimCount: bigint;
    totalResolved: bigint;
  } | null> {
    try {
      const c: any = await (this.base.account as any).config.fetch(configPda());
      return {
        admin: c.admin,
        oracle: c.oracle,
        usdcMint: c.usdcMint,
        claimCount: BigInt(c.claimCount.toString()),
        totalResolved: BigInt(c.totalResolved.toString()),
      };
    } catch {
      return null;
    }
  }

  async getBalance(user: PublicKey = this.publicKey): Promise<bigint> {
    const address = balancePda(user);
    for (const program of [this.er, this.base]) {
      try {
        const b: any = await (program.account as any).userBalance.fetch(address);
        return BigInt(b.amount.toString());
      } catch {
        // not on this layer
      }
    }
    return 0n;
  }

  /** Is this claim currently delegated to the ER? */
  async isDelegated(claimId: bigint): Promise<boolean> {
    const info = await this.baseConnection.getAccountInfo(claimPda(claimId));
    if (!info) return false;
    return !info.owner.equals(this.base.programId);
  }

  /**
   * Batch delegation check — single getMultipleAccountsInfo call for all IDs.
   * Replaces N individual isDelegated() calls with one RPC round-trip.
   */
  async isDelegatedBatch(ids: bigint[]): Promise<Map<bigint, boolean>> {
    const CHUNK = 100; // getMultipleAccountsInfo limit
    const result = new Map<bigint, boolean>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const keys = slice.map((id) => claimPda(id));
      const infos = await this.baseConnection.getMultipleAccountsInfo(keys);
      for (let j = 0; j < slice.length; j++) {
        const info = infos[j];
        result.set(slice[j], info != null && !info.owner.equals(this.base.programId));
      }
    }
    return result;
  }

  /** Is a user's balance PDA currently delegated to the ER? */
  async isBalanceDelegated(user: PublicKey = this.publicKey): Promise<boolean> {
    const info = await this.baseConnection.getAccountInfo(balancePda(user));
    if (!info) return false; // no PDA yet → not delegated
    return !info.owner.equals(this.base.programId);
  }

  async getAllClaims(): Promise<OnchainClaim[]> {
    const cfg = await this.getConfig();
    if (!cfg) return [];
    const out: OnchainClaim[] = [];
    for (let id = 1n; id <= cfg.claimCount; id++) {
      const c = await this.getClaim(id);
      if (c) out.push(c);
    }
    return out;
  }
}

function normalizeClaim(c: any): OnchainClaim {
  return {
    id: BigInt(c.id.toString()),
    creator: c.creator,
    question: c.question,
    creatorPosition: c.creatorPosition,
    counterPosition: c.counterPosition,
    resolutionUrl: c.resolutionUrl,
    category: c.category,
    creatorStake: BigInt(c.creatorStake.toString()),
    totalChallengerStake: BigInt(c.totalChallengerStake.toString()),
    deadline: Number(c.deadline.toString()),
    state: c.state,
    winnerSide: c.winnerSide,
    resolutionSummary: c.resolutionSummary,
    confidence: c.confidence,
    evidenceHash: Uint8Array.from(c.evidenceHash),
    createdAt: Number(c.createdAt.toString()),
    maxChallengers: c.maxChallengers,
    creatorPaid: c.creatorPaid,
    challengers: (c.challengers || []).map((ch: any) => ({
      addr: ch.addr,
      stake: BigInt(ch.stake.toString()),
      paid: ch.paid,
    })),
  };
}
