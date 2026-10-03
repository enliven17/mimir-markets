/**
 * Client-side checks on a server-prepared transaction before the operator
 * key signs it (audit P1-8). The server (or DNS, or a hijacked baseUrl) is
 * not trusted: everything is checked against values configured here.
 *
 *   - every instruction targets the Mimir program (id configured client-side),
 *     ComputeBudget (bounded priority fee) or the ATA program (create only);
 *     a System / SPL Token / unknown program is refused
 *   - each Mimir instruction's discriminator is one the requested action
 *     produces, and its first (signer) account is the operator
 *   - amount, claim PDA and withdraw destination match the request
 *   - each program instruction appears once (no repeated stakes)
 *   - the on-chain `agent` fee recipient is none, the operator, or the
 *     configured payout wallet; ATA creates are for the operator's own USDC
 *   - the fee payer is the operator
 */
import { PublicKey, type Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import idl from "../lib/solana/idl/mimir.json";

export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey("ComputeBudget111111111111111111111111111111");
export const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Above this the priority fee is a drain, not a tip (1 lamport per CU). */
export const DEFAULT_MAX_PRIORITY_MICRO_LAMPORTS = 1_000_000;

/** Program instructions each agent write action may contain. */
export const ACTION_INSTRUCTIONS: Record<string, readonly string[]> = {
  createClaim: ["create_claim", "delegate_claim"],
  challenge: ["challenge_claim"],
  dispute: ["dispute_resolution"],
  deposit: ["deposit"],
  withdraw: ["withdraw"],
  delegateBalance: ["delegate_balance"],
  undelegateBalance: ["undelegate_balance"],
};

interface IdlIx {
  name: string;
  discriminator: number[];
  accounts: Array<{ name: string }>;
}
const IDL_IXS = (idl as unknown as { instructions: IdlIx[] }).instructions;

function idlIx(name: string): IdlIx {
  const ix = IDL_IXS.find((i) => i.name === name);
  if (!ix) throw new Error(`instruction ${name} is not in the Mimir IDL`);
  return ix;
}

export interface TxExpectation {
  /** The write action requested; without it any agent write instruction is accepted. */
  action?: string;
  claimId?: bigint;
  /** Stake (createClaim / challenge) or amount (deposit/withdraw), USDC base units. */
  amountUnits?: bigint;
  /**
   * Who may be named as the position's `agent` (earns the agent fee on the
   * operator's profit). Default: none or the operator.
   */
  agentPayout?: PublicKey;
}

export interface VerifyOptions {
  programId: PublicKey;
  operator: PublicKey;
  expect?: TxExpectation;
  /** For the withdraw destination check; skipped when unset. */
  usdcMint?: PublicKey;
  maxPriorityMicroLamports?: number;
}

function refuse(reason: string): never {
  throw new Error(`refusing to sign: ${reason}`);
}

function claimPda(programId: PublicKey, claimId: bigint): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(claimId);
  return PublicKey.findProgramAddressSync([Buffer.from("claim"), id], programId)[0];
}

/** Borsh: skip one string (u32 length + bytes); returns the next offset. */
function skipString(data: Buffer, at: number): number {
  if (data.length < at + 4) refuse("malformed instruction data");
  return at + 4 + data.readUInt32LE(at);
}

/** Borsh Option<Pubkey> at `at`: null for None. */
function readOptionPubkey(data: Buffer, at: number): PublicKey | null {
  if (data[at] === 0) return null;
  if (data[at] !== 1 || data.length < at + 33) refuse("malformed agent argument");
  return new PublicKey(data.subarray(at + 1, at + 33));
}

function checkComputeBudget(data: Buffer, maxPrice: number): void {
  switch (data[0]) {
    case 1: // RequestHeapFrame
    case 2: // SetComputeUnitLimit
    case 4: // SetLoadedAccountsDataSizeLimit
      return;
    case 3: // SetComputeUnitPrice
      if (data.length < 9) refuse("malformed compute unit price");
      if (data.readBigUInt64LE(1) > BigInt(maxPrice)) refuse("the priority fee is above the configured maximum");
      return;
    default:
      refuse("unsupported ComputeBudget instruction");
  }
}

/** Throws `refusing to sign: ...` unless the transaction is what was asked for. */
export function verifyPreparedTransaction(tx: Transaction, opts: VerifyOptions): void {
  const { programId, operator, expect = {} } = opts;
  const maxPrice = opts.maxPriorityMicroLamports ?? DEFAULT_MAX_PRIORITY_MICRO_LAMPORTS;
  if (!tx.feePayer?.equals(operator)) refuse("the transaction's fee payer is not this operator");

  let allowed: readonly string[];
  if (expect.action !== undefined) {
    const forAction = ACTION_INSTRUCTIONS[expect.action];
    if (!forAction) refuse(`unknown action ${expect.action}`);
    allowed = forAction;
  } else {
    allowed = [...new Set(Object.values(ACTION_INSTRUCTIONS).flat())];
  }
  const discs = new Map(allowed.map((name) => [Buffer.from(idlIx(name).discriminator).toString("hex"), name]));

  let mimirCount = 0;
  const seen = new Set<string>();
  const agentOk = (agent: PublicKey | null) =>
    agent === null || agent.equals(operator) || Boolean(expect.agentPayout?.equals(agent));
  for (const ix of tx.instructions) {
    if (ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
      checkComputeBudget(ix.data, maxPrice);
      continue;
    }
    if (ix.programId.equals(ATA_PROGRAM_ID)) {
      // Create (empty data or 0) / CreateIdempotent (1) only; never RecoverNested.
      if (ix.data.length > 1 || (ix.data.length === 1 && ix.data[0] > 1)) refuse("unsupported ATA instruction");
      // accounts: [payer, ata, wallet, mint, ...]
      if (!ix.keys[0]?.pubkey.equals(operator) || !ix.keys[2]?.pubkey.equals(operator)) refuse("ATA create for another wallet");
      if (opts.usdcMint && !ix.keys[3]?.pubkey.equals(opts.usdcMint)) refuse("ATA create for another mint");
      continue;
    }
    if (!ix.programId.equals(programId)) refuse(`unexpected program ${ix.programId.toBase58()}`);

    mimirCount++;
    const name = discs.get(ix.data.subarray(0, 8).toString("hex"));
    if (!name) refuse(`instruction is not a ${expect.action ?? "known agent write"} instruction`);
    if (!ix.keys[0]?.pubkey.equals(operator)) refuse(`${name}: the signing account is not this operator`);
    if (seen.has(name)) refuse(`${name} appears more than once`);
    seen.add(name);

    const spec = idlIx(name);
    const account = (n: string) => {
      const i = spec.accounts.findIndex((a) => a.name === n);
      return i >= 0 ? ix.keys[i]?.pubkey : undefined;
    };

    if (expect.amountUnits !== undefined && ["challenge_claim", "deposit", "withdraw"].includes(name)) {
      if (ix.data.length < 16 || ix.data.readBigUInt64LE(8) !== expect.amountUnits) {
        refuse(`${name}: the amount differs from the request`);
      }
    }
    if (name === "challenge_claim" && !agentOk(readOptionPubkey(ix.data, 16))) {
      refuse("challenge_claim: unexpected agent fee recipient");
    }
    if (name === "create_claim") {
      // CreateClaimArgs: 5 strings, stake u64, deadline i64, max_challengers u8, agent Option<Pubkey>
      let at = 8;
      for (let i = 0; i < 5; i++) at = skipString(ix.data, at);
      if (ix.data.length < at + 17) refuse("create_claim: malformed arguments");
      if (expect.amountUnits !== undefined && ix.data.readBigUInt64LE(at) !== expect.amountUnits) {
        refuse("create_claim: the stake differs from the request");
      }
      if (!agentOk(readOptionPubkey(ix.data, at + 17))) refuse("create_claim: unexpected agent fee recipient");
      const source = opts.usdcMint ? getAssociatedTokenAddressSync(opts.usdcMint, operator, true) : null;
      if (source && !account("creator_token")?.equals(source)) refuse("create_claim: the stake is not paid from the operator's USDC account");
    }
    if (expect.claimId !== undefined && (name === "challenge_claim" || name === "dispute_resolution")) {
      if (!account("claim")?.equals(claimPda(programId, expect.claimId))) refuse(`${name}: wrong claim account`);
    }
    if (name === "withdraw") {
      if (!account("owner")?.equals(operator)) refuse("withdraw: the balance owner is not this operator");
      const dest = opts.usdcMint ? getAssociatedTokenAddressSync(opts.usdcMint, operator, true) : null;
      if (dest && !account("user_token")?.equals(dest)) {
        refuse("withdraw: the destination is not the operator's USDC account");
      }
    }
  }
  if (mimirCount === 0) refuse("no Mimir instruction in the transaction");
}
