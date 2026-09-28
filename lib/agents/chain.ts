import "server-only";

/**
 * The agent API's only contact with the Mimir program.
 *
 * Mimir never custodies an agent's key, so writes come back as UNSIGNED
 * transactions: built from the program IDL with Anchor's `.instruction()` on a
 * read-only client (a throwaway keypair that never signs), fee payer set to
 * the agent's operator wallet, fresh blockhash from the layer the transaction
 * must land on. The agent signs and submits them itself, in order. Challenges
 * go to the MagicBlock Ephemeral Rollup (zero fee) when the claim is
 * delegated there, exactly like the browser flow in lib/solana/browser-client.
 *
 * Everything IDL-shaped lives in this file, so a program upgrade is one place
 * to update.
 */
import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { MimirSolanaClient, type OnchainClaim } from "@/lib/solana/client";
import {
  ER_VALIDATOR,
  ST_ACTIVE,
  ST_OPEN,
  ST_PROPOSED,
  USDC_MINT,
  balancePda,
  claimPda,
} from "@/lib/solana/config";
import idl from "@/lib/solana/idl/mimir.json";

import { AgentEnvelopeError } from "./api";
import type { WriteParams } from "./params";

export type Layer = "base" | "er";

export interface PreparedTransaction {
  /** Where to submit it: the Solana base layer, or the MagicBlock ER. */
  layer: Layer;
  /** A public RPC for that layer. Any RPC for the same cluster works. */
  rpcUrl: string;
  /** Base64 of a legacy `Transaction`, unsigned, fee payer = operator wallet. */
  transaction: string;
  description: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface PreparedWrite {
  transactions: PreparedTransaction[];
  /** The claim id a createClaim will produce, when it lands before anyone else's. */
  claimId?: string;
}

// Public endpoints only: a server-side SOLANA_RPC may carry a provider key.
const PUBLIC_RPC: Record<Layer, string> = {
  base: process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com",
  er: process.env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC || "https://devnet-as.magicblock.app/",
};

let reader: MimirSolanaClient | null = null;
/** Read-only chain client. Its keypair is random and never signs anything. */
export function chainReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

function connectionFor(layer: Layer): Connection {
  const r = chainReader();
  return layer === "er" ? r.erConnection : r.baseConnection;
}

// ── IDL shape probes ────────────────────────────────────────────────────────

interface IdlLike {
  instructions: Array<{ name: string; args: Array<{ name: string }> }>;
  types?: Array<{ name: string; type: { kind: string; fields?: Array<{ name: string }> } }>;
}
const IDL = idl as unknown as IdlLike;

/** Does this instruction (or its args struct) take an `agent` pubkey? Older IDLs did not. */
function takesAgent(ix: string, argsType?: string): boolean {
  if (argsType) {
    return Boolean(IDL.types?.find((t) => t.name === argsType)?.type.fields?.some((f) => f.name === "agent"));
  }
  return Boolean(IDL.instructions.find((i) => i.name === ix)?.args.some((a) => a.name === "agent"));
}

export function hasInstruction(ix: string): boolean {
  return IDL.instructions.some((i) => i.name === ix);
}

// ── Builders ────────────────────────────────────────────────────────────────

const bn = (v: bigint | number) => new BN(v.toString());
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, owner, true);

function conflict(reason: string, message: string): never {
  throw new AgentEnvelopeError(message, 409, reason);
}

async function prepare(
  layer: Layer,
  feePayer: PublicKey,
  ixs: TransactionInstruction[],
  description: string,
): Promise<PreparedTransaction> {
  const { blockhash, lastValidBlockHeight } = await connectionFor(layer).getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...ixs);
  return {
    layer,
    rpcUrl: PUBLIC_RPC[layer],
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    description,
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

export interface WriteContext {
  operator: PublicKey;
  /** Agent owner credited on-chain for the position (earns the agent fee), or null. */
  agentOwner: PublicKey | null;
}

/**
 * Build the unsigned transactions for one write. Cheap state checks run first
 * so an agent is not asked to sign something the program will reject for an
 * obvious reason (paused, wrong layer, wrong state).
 */
export async function prepareWrite(parsed: WriteParams, ctx: WriteContext): Promise<PreparedWrite> {
  const r = chainReader();
  const { operator, agentOwner } = ctx;

  switch (parsed.action) {
    case "createClaim": {
      const cfg = await r.getConfig();
      if (!cfg) throw new AgentEnvelopeError("the program config is unreadable", 503, "chain_unavailable");
      if (cfg.paused) conflict("program_paused", "the program is paused; new positions are refused");
      const p = parsed.params;
      const claimId = cfg.claimCount + 1n;
      const args: Record<string, unknown> = {
        question: p.question,
        creatorPosition: p.creatorPosition,
        counterPosition: p.counterPosition,
        resolutionUrl: p.resolutionUrl,
        category: p.category,
        stakeAmount: bn(p.stakeUnits),
        deadline: bn(p.deadline),
        maxChallengers: p.maxChallengers,
      };
      if (takesAgent("create_claim", "CreateClaimArgs")) args.agent = agentOwner;
      const create = await r.base.methods
        .createClaim(args)
        .accounts({ creator: operator, claim: claimPda(claimId), creatorToken: ata(operator) })
        .instruction();
      const transactions = [
        await prepare("base", operator, [create], `create claim #${claimId} staking ${p.stakeUnits} units`),
      ];
      if (p.delegate) {
        const delegate = await r.base.methods
          .delegateClaim(bn(claimId))
          .accounts({ payer: operator, claim: claimPda(claimId) })
          .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
          .instruction();
        transactions.push(
          await prepare("base", operator, [delegate], `delegate claim #${claimId} to the Ephemeral Rollup`),
        );
      }
      return { transactions, claimId: claimId.toString() };
    }

    case "challenge": {
      const { claimId, stakeUnits } = parsed.params;
      const claim = await r.getClaim(claimId);
      if (!claim) throw new AgentEnvelopeError(`claim ${claimId} does not exist`, 404, "unknown_claim");
      if (claim.state !== ST_OPEN && claim.state !== ST_ACTIVE) conflict("claim_closed", "the claim no longer takes challenges");
      if (claim.creator.equals(operator)) conflict("self_challenge", "the operator created this claim");
      const [claimInEr, balanceInEr] = await Promise.all([r.isDelegated(claimId), r.isBalanceDelegated(operator)]);
      if (claimInEr && !balanceInEr) {
        conflict("balance_not_delegated", "the claim lives in the ER: call delegateBalance first");
      }
      if (!claimInEr && balanceInEr) {
        conflict("balance_delegated", "the claim is on the base layer: call undelegateBalance first");
      }
      const layer: Layer = claimInEr ? "er" : "base";
      const program = layer === "er" ? r.er : r.base;
      const args: unknown[] = [bn(stakeUnits)];
      if (takesAgent("challenge_claim")) args.push(agentOwner);
      const ix = await program.methods
        .challengeClaim(...args)
        .accounts({ challenger: operator, claim: claimPda(claimId), balance: balancePda(operator) })
        .instruction();
      return {
        transactions: [
          await prepare(layer, operator, [ix], `challenge claim #${claimId} with ${stakeUnits} units`),
        ],
      };
    }

    case "dispute": {
      if (!hasInstruction("dispute_resolution")) {
        throw new AgentEnvelopeError("this program build has no disputes", 501, "not_supported");
      }
      const { claimId } = parsed.params;
      const claim = await r.getBaseClaim(claimId);
      if (!claim) throw new AgentEnvelopeError(`claim ${claimId} is not on the base layer`, 404, "unknown_claim");
      if (claim.state !== ST_PROPOSED) conflict("not_proposed", "only a PROPOSED verdict can be disputed");
      const ix = await r.base.methods
        .disputeResolution()
        .accounts({ disputer: operator, claim: claimPda(claimId), disputerToken: ata(operator) })
        .instruction();
      return {
        transactions: [await prepare("base", operator, [ix], `dispute the proposed verdict on claim #${claimId}`)],
      };
    }

    case "deposit": {
      const ix = await r.base.methods
        .deposit(bn(parsed.params.amountUnits))
        .accounts({ user: operator, userToken: ata(operator) })
        .instruction();
      return {
        transactions: [await prepare("base", operator, [ix], `deposit ${parsed.params.amountUnits} units`)],
      };
    }

    case "withdraw": {
      if (await r.isBalanceDelegated(operator)) {
        conflict("balance_delegated", "the balance is in the ER: call undelegateBalance first");
      }
      const ix = await r.base.methods
        .withdraw(bn(parsed.params.amountUnits))
        .accounts({ user: operator, owner: operator, userToken: ata(operator) })
        .instruction();
      return {
        transactions: [await prepare("base", operator, [ix], `withdraw ${parsed.params.amountUnits} units`)],
      };
    }

    case "delegateBalance": {
      if (await r.isBalanceDelegated(operator)) conflict("already_delegated", "the balance is already in the ER");
      const ix = await r.base.methods
        .delegateBalance()
        .accounts({ payer: operator, balance: balancePda(operator) })
        .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
        .instruction();
      return { transactions: [await prepare("base", operator, [ix], "delegate the balance to the ER")] };
    }

    case "undelegateBalance": {
      if (!(await r.isBalanceDelegated(operator))) conflict("not_delegated", "the balance is on the base layer");
      const ix = await r.er.methods
        .undelegateBalance()
        .accounts({ payer: operator, balance: balancePda(operator) })
        .instruction();
      return { transactions: [await prepare("er", operator, [ix], "commit and return the balance to base")] };
    }
  }
}

// ── Simulation (dry run) ────────────────────────────────────────────────────

export interface SimulationResult {
  ok: boolean;
  /** The program error, as the RPC reports it. */
  err: string | null;
  logs: string[];
  unitsConsumed: number | null;
}

/**
 * `simulateTransaction` without signatures: sigVerify off, blockhash replaced.
 * Program logs are on-chain output, so they are safe (and useful) to return.
 */
export async function simulatePrepared(p: PreparedTransaction): Promise<SimulationResult> {
  const tx = Transaction.from(Buffer.from(p.transaction, "base64"));
  const res = await connectionFor(p.layer).simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  return {
    ok: res.value.err === null,
    err: res.value.err === null ? null : JSON.stringify(res.value.err),
    logs: (res.value.logs ?? []).slice(-30),
    unitsConsumed: res.value.unitsConsumed ?? null,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** JSON-safe copy: bigints as strings, keys as base58, bytes as hex. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

export async function readClaim(claimId: bigint): Promise<{ claim: OnchainClaim; delegated: boolean } | null> {
  const r = chainReader();
  const [claim, delegated] = await Promise.all([r.getClaim(claimId), r.isDelegated(claimId)]);
  return claim ? { claim, delegated } : null;
}

export interface Balances {
  /** Free USDC in the Mimir vault balance PDA, ready to challenge with. */
  vaultUnits: string;
  balanceDelegated: boolean;
  /** USDC in the operator's token account (what createClaim and deposit draw on). */
  walletUsdcUnits: string;
  lamports: number;
}

export async function readBalances(operator: PublicKey): Promise<Balances> {
  const r = chainReader();
  const [vault, delegated, lamports, token] = await Promise.all([
    r.getBalance(operator),
    r.isBalanceDelegated(operator),
    r.baseConnection.getBalance(operator),
    r.baseConnection.getTokenAccountBalance(ata(operator)).catch(() => null),
  ]);
  return {
    vaultUnits: vault.toString(),
    balanceDelegated: delegated,
    walletUsdcUnits: token?.value.amount ?? "0",
    lamports,
  };
}

/** Agent-owner fees accrued on-chain for this owner, in USDC base units. */
export async function readAgentFees(owner: PublicKey): Promise<bigint> {
  const r = chainReader();
  return typeof r.getAgentFees === "function" ? r.getAgentFees(owner) : 0n;
}
