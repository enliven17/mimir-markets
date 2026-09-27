/**
 * MimirSolanaClient — high-level client for the Mimir program (V3).
 *
 * Two connections:
 *  - base:  Solana devnet (deposits, claim creation, resolution, disputes, payouts)
 *  - er:    MagicBlock Ephemeral Rollup (zero-fee, ~30ms challenges)
 *
 * The same Anchor IDL drives both; only the provider differs. Delegated
 * accounts (claim + user balance PDAs) live in the ER until someone commits +
 * undelegates them; everything after the deadline (propose, dispute,
 * finalize, refund, payouts) runs on the base layer.
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
  MIMIR_PROGRAM_ID,
  USDC_MINT,
  BOND_REFUND_DUE,
  ST_RESOLVED,
  balancePda,
  claimPda,
  configPda,
  feeBalancePda,
} from "./config";
import { creatorGross, challengerGross } from "./fees";
import idl from "./idl/mimir.json";

/** The IDL, pointed at the configured program id (env override safe). */
export function mimirIdl(): anchor.Idl {
  return { ...(idl as anchor.Idl), address: MIMIR_PROGRAM_ID.toBase58() };
}

const NONE = PublicKey.default;
const isSet = (k: PublicKey | null | undefined): k is PublicKey => Boolean(k && !k.equals(NONE));

export interface CreateClaimInput {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  stakeAmount: bigint; // 6dp units
  deadline: number; // unix seconds
  maxChallengers?: number;
  /** Owner of the agent opening the position (earns the agent fee on profit). */
  agent?: PublicKey | null;
}

export interface OnchainChallenger {
  addr: PublicKey;
  stake: bigint;
  paid: boolean;
  /** Agent owner credited for this position (PublicKey.default = none). */
  agent: PublicKey;
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
  /** Proposal summary while PROPOSED/DISPUTED, final summary once RESOLVED. */
  resolutionSummary: string;
  confidence: number;
  evidenceHash: Uint8Array;
  createdAt: number;
  maxChallengers: number;
  creatorPaid: boolean;
  challengers: OnchainChallenger[];
  // Fee terms frozen at creation
  creatorAgent: PublicKey;
  feeRecipient: PublicKey;
  platformFeeBps: number;
  agentFeeBps: number;
  totalFees: bigint;
  // Optimistic resolution
  disputeWindow: number;
  resolutionGrace: number;
  proposedSide: number;
  proposedAt: number;
  disputableUntil: number;
  disputer: PublicKey;
  disputedAt: number;
  bond: bigint;
  bondState: number;
  resolvedAt: number;
}

export interface OnchainConfig {
  admin: PublicKey;
  pendingAdmin: PublicKey;
  oracle: PublicKey;
  pendingOracle: PublicKey;
  pendingOracleEta: number;
  usdcMint: PublicKey;
  claimCount: bigint;
  totalResolved: bigint;
  paused: boolean;
  disputeWindow: number;
  resolutionGrace: number;
  feeRecipient: PublicKey;
  platformFeeBps: number;
  agentFeeBps: number;
  pendingFeeRecipient: PublicKey;
  pendingPlatformFeeBps: number;
  pendingAgentFeeBps: number;
  pendingFeeEta: number;
  feesAccrued: bigint;
  lifetimeFeesAccrued: bigint;
  lifetimeFeesClaimed: bigint;
}

export interface InitializeInput {
  oracle: PublicKey;
  feeRecipient: PublicKey;
  platformFeeBps: number;
  agentFeeBps: number;
  disputeWindow: number;
  resolutionGrace: number;
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

const bn = (v: bigint | number) => new BN(v.toString());

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
    this.base = new Program(mimirIdl(), baseProvider);
    this.er = new Program(mimirIdl(), erProvider);
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  usdcAta(owner: PublicKey = this.publicKey): PublicKey {
    return getAssociatedTokenAddressSync(USDC_MINT, owner, true);
  }

  // ── Governance (admin) ────────────────────────────────────────────────

  async initialize(input: InitializeInput): Promise<string> {
    return this.base.methods
      .initialize({
        oracle: input.oracle,
        feeRecipient: input.feeRecipient,
        platformFeeBps: input.platformFeeBps,
        agentFeeBps: input.agentFeeBps,
        disputeWindow: bn(input.disputeWindow),
        resolutionGrace: bn(input.resolutionGrace),
      })
      .accounts({ admin: this.publicKey, usdcMint: USDC_MINT })
      .rpc();
  }

  private admin(method: string, ...args: unknown[]): Promise<string> {
    return (this.base.methods as any)[method](...args).accounts({ admin: this.publicKey }).rpc();
  }

  setPaused(paused: boolean): Promise<string> {
    return this.admin("setPaused", paused);
  }
  proposeAdmin(next: PublicKey): Promise<string> {
    return this.admin("proposeAdmin", next);
  }
  queueOracle(next: PublicKey): Promise<string> {
    return this.admin("queueOracle", next);
  }
  cancelOracle(): Promise<string> {
    return this.admin("cancelOracle");
  }
  /** Applies to claims created afterwards only (terms are frozen per claim). */
  setWindows(disputeWindow: number, resolutionGrace: number): Promise<string> {
    return this.admin("setWindows", bn(disputeWindow), bn(resolutionGrace));
  }
  queueFeePolicy(platformFeeBps: number, agentFeeBps: number, feeRecipient: PublicKey): Promise<string> {
    return this.admin("queueFeePolicy", platformFeeBps, agentFeeBps, feeRecipient);
  }
  cancelFeePolicy(): Promise<string> {
    return this.admin("cancelFeePolicy");
  }

  async acceptAdmin(): Promise<string> {
    return this.base.methods.acceptAdmin().accounts({ newAdmin: this.publicKey }).rpc();
  }
  /** Permissionless once the 2-day timelock has passed. */
  async executeOracle(): Promise<string> {
    return this.base.methods.executeOracle().accounts({}).rpc();
  }
  /** Permissionless once the 2-day timelock has passed. */
  async executeFeePolicy(): Promise<string> {
    return this.base.methods.executeFeePolicy().accounts({}).rpc();
  }

  /** Admin or fee recipient moves accrued platform fees to the recipient's USDC ATA. */
  async withdrawFees(amount: bigint, feeRecipient: PublicKey): Promise<string> {
    return this.base.methods
      .withdrawFees(bn(amount))
      .accounts({ authority: this.publicKey, recipientToken: this.usdcAta(feeRecipient) })
      .rpc();
  }

  // ── Escrow ────────────────────────────────────────────────────────────

  async deposit(amount: bigint): Promise<string> {
    return this.base.methods
      .deposit(bn(amount))
      .accounts({ user: this.publicKey, userToken: this.usdcAta() })
      .rpc();
  }

  async withdraw(amount: bigint): Promise<string> {
    return this.base.methods
      .withdraw(bn(amount))
      .accounts({ user: this.publicKey, owner: this.publicKey, userToken: this.usdcAta() })
      .rpc();
  }

  async openFeeAccount(owner: PublicKey): Promise<string> {
    return this.base.methods.openFeeAccount(owner).accounts({ payer: this.publicKey }).rpc();
  }

  async claimAgentFees(to: PublicKey = this.usdcAta()): Promise<string> {
    return this.base.methods.claimAgentFees().accounts({ owner: this.publicKey, toToken: to }).rpc();
  }

  async getAgentFees(owner: PublicKey = this.publicKey): Promise<bigint> {
    const f: any = await (this.base.account as any).feeBalance.fetchNullable(feeBalancePda(owner));
    return f ? BigInt(f.amount.toString()) : 0n;
  }

  // ── Claim lifecycle ───────────────────────────────────────────────────

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
        stakeAmount: bn(input.stakeAmount),
        deadline: bn(input.deadline),
        maxChallengers: input.maxChallengers ?? 0,
        agent: input.agent ?? null,
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
      .accounts({ creator: this.publicKey, claim: claimPda(claimId), creatorToken: this.usdcAta() })
      .rpc();
  }

  private challenge(program: Program, claimId: bigint, stake: bigint, agent?: PublicKey | null) {
    return program.methods.challengeClaim(bn(stake), agent ?? null).accounts({
      challenger: this.publicKey,
      claim: claimPda(claimId),
      balance: balancePda(this.publicKey),
    });
  }

  /** Runs inside the Ephemeral Rollup — zero fee, ~30ms */
  async challengeClaimER(claimId: bigint, stake: bigint, agent?: PublicKey | null): Promise<string> {
    return this.challenge(this.er, claimId, stake, agent).rpc({ skipPreflight: true });
  }

  /** Same instruction, base layer (pre-delegation fallback) */
  async challengeClaimBase(claimId: bigint, stake: bigint, agent?: PublicKey | null): Promise<string> {
    return this.challenge(this.base, claimId, stake, agent).rpc();
  }

  // ── Optimistic resolution (base layer) ────────────────────────────────

  /** Oracle proposes a verdict; the claim becomes PROPOSED (or RESOLVED if its dispute window is 0). */
  async proposeResolution(
    claimId: bigint,
    winnerSide: number,
    summary: string,
    confidence: number,
    evidenceHash: Uint8Array
  ): Promise<string> {
    return this.base.methods
      .proposeResolution(winnerSide, summary, confidence, Array.from(evidenceHash))
      .accounts({ oracle: this.publicKey, claim: claimPda(claimId) })
      .rpc();
  }

  /** Participant disputes a proposal, posting the 2 USDC bond from their USDC ATA. */
  async disputeResolution(claimId: bigint): Promise<string> {
    return this.base.methods
      .disputeResolution()
      .accounts({ disputer: this.publicKey, claim: claimPda(claimId), disputerToken: this.usdcAta() })
      .rpc();
  }

  /** Permissionless once the dispute window has closed. */
  async finalizeResolution(claimId: bigint): Promise<string> {
    return this.base.methods.finalizeResolution().accounts({ claim: claimPda(claimId) }).rpc();
  }

  /** Admin (arbiter) rules on a DISPUTED claim. */
  async settleDispute(
    claimId: bigint,
    winnerSide: number,
    summary: string,
    confidence: number,
    evidenceHash: Uint8Array
  ): Promise<string> {
    return this.base.methods
      .settleDispute(winnerSide, summary, confidence, Array.from(evidenceHash))
      .accounts({ admin: this.publicKey, claim: claimPda(claimId) })
      .rpc();
  }

  /** Permissionless escape hatch after deadline (or dispute) + resolution grace. */
  async refundExpired(claimId: bigint): Promise<string> {
    return this.base.methods.refundExpired().accounts({ caller: this.publicKey, claim: claimPda(claimId) }).rpc();
  }

  /** Permissionless: return a refundable dispute bond to the disputer's ATA. */
  async refundBond(claimId: bigint, disputer: PublicKey): Promise<string> {
    return this.base.methods
      .refundBond()
      .accounts({ claim: claimPda(claimId), disputerToken: this.usdcAta(disputer) })
      .rpc();
  }

  // ── Payouts (permissionless cranks) ───────────────────────────────────

  /** FeeBalance to pass for an agent fee leg, opening it first if needed; null when no agent fee is due. */
  private async agentFeeAccount(agent: PublicKey, agentFeeBps: number, profit: boolean): Promise<PublicKey | null> {
    if (!isSet(agent) || agentFeeBps === 0 || !profit) return null;
    const pda = feeBalancePda(agent);
    const info = await this.baseConnection.getAccountInfo(pda);
    if (!info) await this.openFeeAccount(agent);
    return pda;
  }

  async payoutCreator(claimId: bigint, creator?: PublicKey): Promise<string> {
    const c = await this.getBaseClaim(claimId);
    if (!c) throw new Error(`claim ${claimId} not found on the base layer`);
    const leg = creatorGross(c.winnerSide, c.creatorStake, c.totalChallengerStake);
    const agentFees = await this.agentFeeAccount(
      c.creatorAgent.equals(c.creator) ? NONE : c.creatorAgent,
      c.agentFeeBps,
      Boolean(leg && leg.gross > leg.principal)
    );
    return this.base.methods
      .payoutCreator()
      .accounts({ claim: claimPda(claimId), creatorToken: this.usdcAta(creator ?? c.creator), agentFees } as any)
      .rpc();
  }

  async payoutChallenger(claimId: bigint, index: number, challenger?: PublicKey): Promise<string> {
    const c = await this.getBaseClaim(claimId);
    if (!c) throw new Error(`claim ${claimId} not found on the base layer`);
    const ch = c.challengers[index];
    if (!ch) throw new Error(`claim ${claimId} has no challenger #${index}`);
    const leg = challengerGross(c.winnerSide, ch.stake, c.creatorStake, c.totalChallengerStake);
    const agentFees = await this.agentFeeAccount(
      ch.agent.equals(ch.addr) ? NONE : ch.agent,
      c.agentFeeBps,
      Boolean(leg && leg.gross > leg.principal)
    );
    return this.base.methods
      .payoutChallenger(index)
      .accounts({ claim: claimPda(claimId), challengerToken: this.usdcAta(challenger ?? ch.addr), agentFees } as any)
      .rpc();
  }

  /**
   * Crank every unpaid leg of a RESOLVED claim, plus a refundable dispute
   * bond. Each leg is independent: one failure is reported, the rest still run.
   */
  async crankPayouts(claimId: bigint): Promise<{ paid: number; failed: string[] }> {
    const c = await this.getBaseClaim(claimId);
    const out = { paid: 0, failed: [] as string[] };
    if (!c || c.state !== ST_RESOLVED) return out;
    const run = async (label: string, fn: () => Promise<string>) => {
      try {
        await fn();
        out.paid++;
      } catch (err: any) {
        out.failed.push(`${label}: ${String(err?.message ?? err).slice(0, 120)}`);
      }
    };
    if (!c.creatorPaid && creatorGross(c.winnerSide, c.creatorStake, c.totalChallengerStake)) {
      await run("creator", () => this.payoutCreator(claimId));
    }
    for (let i = 0; i < c.challengers.length; i++) {
      const ch = c.challengers[i];
      if (ch.paid || !challengerGross(c.winnerSide, ch.stake, c.creatorStake, c.totalChallengerStake)) continue;
      await run(`challenger#${i}`, () => this.payoutChallenger(claimId, i));
    }
    if (c.bondState === BOND_REFUND_DUE) {
      await run("bond", () => this.refundBond(claimId, c.disputer));
    }
    return out;
  }

  // ── MagicBlock ER: delegation ─────────────────────────────────────────

  async delegateClaim(claimId: bigint): Promise<string> {
    return this.base.methods
      .delegateClaim(bn(claimId))
      .accounts({ payer: this.publicKey, claim: claimPda(claimId) })
      .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
      .rpc();
  }

  async delegateBalance(): Promise<string> {
    return this.base.methods
      .delegateBalance()
      .accounts({ payer: this.publicKey, balance: balancePda(this.publicKey) })
      .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
      .rpc();
  }

  /** Commit ER state and hand the claim back to the base layer (permissionless). */
  async undelegateClaim(claimId: bigint): Promise<string> {
    return this.er.methods
      .undelegateClaim()
      .accounts({ payer: this.publicKey, claim: claimPda(claimId) })
      .rpc({ skipPreflight: true });
  }

  async undelegateBalance(): Promise<string> {
    return this.er.methods
      .undelegateBalance()
      .accounts({ payer: this.publicKey, balance: balancePda(this.publicKey) })
      .rpc({ skipPreflight: true });
  }

  /** Undelegate a claim and wait (up to ~30s) until the base layer owns it again. */
  async ensureClaimOnBase(claimId: bigint): Promise<boolean> {
    if (!(await this.isDelegated(claimId))) return true;
    await this.undelegateClaim(claimId);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!(await this.isDelegated(claimId))) return true;
    }
    return false;
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

  async getConfig(): Promise<OnchainConfig | null> {
    try {
      const c: any = await (this.base.account as any).config.fetch(configPda());
      return normalizeConfig(c);
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

const big = (v: any): bigint => BigInt(v.toString());
const num = (v: any): number => Number(v.toString());

export function normalizeConfig(c: any): OnchainConfig {
  return {
    admin: c.admin,
    pendingAdmin: c.pendingAdmin,
    oracle: c.oracle,
    pendingOracle: c.pendingOracle,
    pendingOracleEta: num(c.pendingOracleEta),
    usdcMint: c.usdcMint,
    claimCount: big(c.claimCount),
    totalResolved: big(c.totalResolved),
    paused: c.paused,
    disputeWindow: num(c.disputeWindow),
    resolutionGrace: num(c.resolutionGrace),
    feeRecipient: c.feeRecipient,
    platformFeeBps: c.platformFeeBps,
    agentFeeBps: c.agentFeeBps,
    pendingFeeRecipient: c.pendingFeeRecipient,
    pendingPlatformFeeBps: c.pendingPlatformFeeBps,
    pendingAgentFeeBps: c.pendingAgentFeeBps,
    pendingFeeEta: num(c.pendingFeeEta),
    feesAccrued: big(c.feesAccrued),
    lifetimeFeesAccrued: big(c.lifetimeFeesAccrued),
    lifetimeFeesClaimed: big(c.lifetimeFeesClaimed),
  };
}

export function normalizeClaim(c: any): OnchainClaim {
  return {
    id: big(c.id),
    creator: c.creator,
    question: c.question,
    creatorPosition: c.creatorPosition,
    counterPosition: c.counterPosition,
    resolutionUrl: c.resolutionUrl,
    category: c.category,
    creatorStake: big(c.creatorStake),
    totalChallengerStake: big(c.totalChallengerStake),
    deadline: num(c.deadline),
    state: c.state,
    winnerSide: c.winnerSide,
    resolutionSummary: c.resolutionSummary,
    confidence: c.confidence,
    evidenceHash: Uint8Array.from(c.evidenceHash),
    createdAt: num(c.createdAt),
    maxChallengers: c.maxChallengers,
    creatorPaid: c.creatorPaid,
    challengers: (c.challengers || []).map((ch: any) => ({
      addr: ch.addr,
      stake: big(ch.stake),
      paid: ch.paid,
      agent: ch.agent,
    })),
    creatorAgent: c.creatorAgent,
    feeRecipient: c.feeRecipient,
    platformFeeBps: c.platformFeeBps,
    agentFeeBps: c.agentFeeBps,
    totalFees: big(c.totalFees),
    disputeWindow: num(c.disputeWindow),
    resolutionGrace: num(c.resolutionGrace),
    proposedSide: c.proposedSide,
    proposedAt: num(c.proposedAt),
    disputableUntil: num(c.disputableUntil),
    disputer: c.disputer,
    disputedAt: num(c.disputedAt),
    bond: big(c.bond),
    bondState: c.bondState,
    resolvedAt: num(c.resolvedAt),
  };
}
