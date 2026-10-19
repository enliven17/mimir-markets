/**
 * Native Arc sign-in: an Arc (EVM) wallet instead of a Solana one, still with the passkey account for every action.
 *
 * Binding: the EVM wallet and the passkey account both sign `arcEvmBindMessage` (like lib/arc/bind.ts for Solana):
 * the wallet's signature proves who is binding, the account's proves the account is theirs.
 *
 * Spending without depositing: the wallet signs ONE approve on Arc USDC's ERC-20 interface (ARC_USDC, 6 dp) for the
 * passkey account. When a user operation needs more native USDC than the account holds, `withWalletFunding` puts
 * USDC.transferFrom(wallet → account, shortfall) in front of the calls, in the same passkey prompt. The interface
 * moves the native (18 dp) balance itself, so the payable call that follows has the value
 * (scripts/arc-poc/_allowance-proof.mjs proved it on Arc testnet).
 *
 * Pure and isomorphic.
 */
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import type { ArcCall } from "./cctp-arc";
import { ARC_USDC } from "./config";
import { normalizeArcAddress } from "./encoding";

export const ARC_EVM_BIND_TTL_MS = 5 * 60_000;
/** 18-dp native wei per 6-dp USDC unit. */
export const WEI_PER_UNIT = 1_000_000_000_000n;
/** The spending cap the setup suggests: 100 USDC. */
export const DEFAULT_CAP_UNITS = 100_000_000n;

export function arcEvmBindMessage(evm: string, arc: string, signedAt: number): string {
  return [
    "Mimir Arc account",
    `wallet: ${evm}`,
    `arc: ${arc}`,
    `signedAt: ${signedAt}`,
    "This links your Arc wallet to your Mimir passkey account. It moves no funds.",
  ].join("\n");
}

/** Within the TTL, with the same allowance for a client clock running ahead. */
export const isFreshArcEvmBind = (signedAt: number, now = Date.now()) =>
  Number.isSafeInteger(signedAt) && signedAt <= now + 60_000 && now - signedAt <= ARC_EVM_BIND_TTL_MS;

/** A checksummed EVM address, or null. */
export const normalizeEvmAddress = normalizeArcAddress;

const HEX_SIGNATURE = /^0x[0-9a-fA-F]{130,20000}$/;
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{16,512}$/;

export interface ArcEvmBindRequest {
  evm: Address;
  arc: Address;
  signedAt: number;
  evmSignature: Hex;
  arcSignature: Hex;
  credentialId: string | null;
}

export type ArcEvmBindCheck = { ok: true; request: ArcEvmBindRequest; message: string } | { ok: false; status: 400 | 401; error: string };

/** Shape and freshness. Both signatures are checked by the route (they need the Arc RPC for smart wallets). */
export function checkArcEvmBindBody(body: Record<string, unknown>, now = Date.now()): ArcEvmBindCheck {
  const evm = normalizeEvmAddress(body.evm);
  if (!evm) return { ok: false, status: 400, error: "wallet must be an EVM address" };
  const arc = normalizeArcAddress(body.arc);
  if (!arc) return { ok: false, status: 400, error: "arc must be an EVM address" };
  if (evm.toLowerCase() === arc.toLowerCase()) return { ok: false, status: 400, error: "the wallet and the passkey account must differ" };
  const signedAt = Number(body.signedAt);
  if (!isFreshArcEvmBind(signedAt, now)) return { ok: false, status: 401, error: "signedAt must be a ms timestamp within 5 minutes of now" };
  const evmSignature = typeof body.evmSignature === "string" ? body.evmSignature.trim() : "";
  const arcSignature = typeof body.arcSignature === "string" ? body.arcSignature.trim() : "";
  if (!HEX_SIGNATURE.test(evmSignature) || !HEX_SIGNATURE.test(arcSignature)) return { ok: false, status: 400, error: "signatures must be hex" };
  const credentialId = typeof body.credentialId === "string" && CREDENTIAL_ID.test(body.credentialId) ? body.credentialId : null;
  return {
    ok: true,
    message: arcEvmBindMessage(evm, arc, signedAt),
    request: { evm, arc, signedAt, evmSignature: evmSignature as Hex, arcSignature: arcSignature as Hex, credentialId },
  };
}

// ───────────── holder-style proof for an EVM wallet (access / invite codes)

export const EVM_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
export const EVM_WALLET_HEADER = "x-mimir-evm";
export const EVM_PROOF_HEADER = "x-mimir-evm-proof";

export function evmProofMessage(evm: string, signedAt: number): string {
  return [
    "Mimir wallet proof",
    `wallet: ${evm}`,
    `signedAt: ${signedAt}`,
    "This only proves you control this Arc wallet so Mimir can check your access. It moves no funds.",
  ].join("\n");
}

export function parseEvmProofHeader(value: string | null | undefined, now = Date.now()): { signedAt: number; signature: Hex } | null {
  const m = /^(\d{12,14})\.(0x[0-9a-fA-F]{130,20000})$/.exec((value ?? "").trim());
  if (!m) return null;
  const signedAt = Number(m[1]);
  if (signedAt > now + 5 * 60_000 || now - signedAt > EVM_PROOF_TTL_MS) return null;
  return { signedAt, signature: m[2] as Hex };
}

// ───────────── spending from the wallet

/** Whole 6-dp units that cover `wei` (rounded up: the interface moves units, the payable call spends wei). */
export const unitsForWei = (wei: bigint): bigint => (wei <= 0n ? 0n : (wei + WEI_PER_UNIT - 1n) / WEI_PER_UNIT);

/** What the account can draw from the wallet right now, in units: the allowance, capped by the wallet's balance. */
export const walletSpendableUnits = (allowanceUnits: bigint, walletUnits: bigint): bigint => (allowanceUnits < walletUnits ? allowanceUnits : walletUnits);

export interface WalletFunding {
  wallet: Address;
  account: Address;
  /** The account's native balance, wei. */
  accountWei: bigint;
  allowanceUnits: bigint;
  walletUnits: bigint;
}

export class NotEnoughUsdcError extends Error {
  constructor(public readonly shortUnits: bigint) {
    super("Not enough USDC: raise your spending cap or add USDC to your Arc wallet.");
  }
}

export function transferFromCall(wallet: Address, account: Address, units: bigint): ArcCall {
  return { to: ARC_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [wallet, account, units] }), value: 0n };
}

/**
 * The calls as they must run: unchanged when the account already holds what they spend, else with a transferFrom of
 * the shortfall from the wallet in front. Throws NotEnoughUsdcError when the allowance or the wallet can't cover it.
 */
export function withWalletFunding(calls: ArcCall[], f: WalletFunding): ArcCall[] {
  const needWei = calls.reduce((s, c) => s + (c.value ?? 0n), 0n);
  if (needWei <= f.accountWei) return calls;
  const units = unitsForWei(needWei - f.accountWei);
  const can = walletSpendableUnits(f.allowanceUnits, f.walletUnits);
  if (units > can) throw new NotEnoughUsdcError(units - can);
  return [transferFromCall(f.wallet, f.account, units), ...calls];
}

/** The wallet's own transactions (sent from the browser wallet, not the passkey). */
export const approveData = (spender: Address, units: bigint): Hex => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, units] });
export const transferData = (to: Address, units: bigint): Hex => encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, units] });

/** Send the account's USDC back to the wallet: a plain native transfer from the passkey account. */
export const sendBackCall = (wallet: Address, wei: bigint): ArcCall => ({ to: wallet, data: "0x", value: wei });

/**
 * The passkey session, drawing from the bound wallet when it runs short: every sendCalls reads the balances fresh and
 * runs through withWalletFunding, so stake and create forms need no change.
 */
export function fundedSession<S extends { address: Address; sendCalls(calls: ArcCall[]): Promise<R> }, R>(
  session: S,
  wallet: Address,
  read: () => Promise<Omit<WalletFunding, "wallet" | "account">>,
): S {
  return {
    ...session,
    async sendCalls(calls: ArcCall[]) {
      const needWei = calls.reduce((s, c) => s + (c.value ?? 0n), 0n);
      if (needWei === 0n) return session.sendCalls(calls);
      return session.sendCalls(withWalletFunding(calls, { wallet, account: session.address, ...(await read()) }));
    },
  };
}
