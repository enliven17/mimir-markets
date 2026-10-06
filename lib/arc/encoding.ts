/**
 * Address and amount encoders for CCTP between Solana and Arc. Pure and
 * isomorphic.
 *
 * CCTP names the recipient on the other chain as 32 bytes (`mintRecipient`):
 * an EVM address is left-padded with 12 zero bytes; a Solana address is its
 * 32 raw bytes. On Solana → Arc the recipient is the user's Arc account; on
 * Arc → Solana it is the user's USDC token account (ATA), not the wallet.
 */
import bs58 from "bs58";
import { bytesToHex, getAddress, hexToBytes as viemHexToBytes, isAddress, isHex, type Address, type Hex } from "viem";

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
export const USDC_UNITS = 1_000_000n;

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/** A checksummed EVM address, or null. */
export function normalizeArcAddress(value: unknown): Address | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return isAddress(v, { strict: false }) ? getAddress(v) : null;
}

export function evmAddressToBytes32(address: string): Hex {
  const a = normalizeArcAddress(address);
  if (!a) throw new Error(`not an EVM address: ${address}`);
  return `0x${"00".repeat(12)}${a.slice(2).toLowerCase()}` as Hex;
}

/** The raw 32 bytes, for Solana instructions that take a Pubkey-shaped recipient. */
export function evmAddressToBytes(address: string): Uint8Array {
  return hexToBytes(evmAddressToBytes32(address));
}

export function bytes32ToEvmAddress(value: string): Address {
  if (!HEX32.test(value) || !/^0x0{24}/.test(value)) throw new Error("not a left-padded EVM address");
  return getAddress(`0x${value.slice(26)}`);
}

export function solanaAddressToBytes32(base58: string): Hex {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(base58.trim());
  } catch {
    throw new Error(`not a Solana address: ${base58}`);
  }
  if (bytes.length !== 32) throw new Error(`not a Solana address: ${base58}`);
  return bytesToHex(bytes);
}

export function bytes32ToSolanaAddress(value: string): string {
  if (!HEX32.test(value)) throw new Error("not 32 bytes of hex");
  return bs58.encode(hexToBytes(value));
}

export function hexToBytes(value: string): Uint8Array {
  const h = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(h, { strict: true }) || h.length % 2 !== 0) throw new Error("bad hex");
  return viemHexToBytes(h);
}

/**
 * "1.5" → 1_500_000n (USDC, 6 dp). Null for anything that is not a positive
 * decimal with at most 6 places: no floats, so 0.1 + 0.2 never drifts.
 */
export function parseUsdcAmount(value: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{0,6}))?$/.exec(value.trim());
  if (!m) return null;
  const units = BigInt(m[1]) * USDC_UNITS + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return units > 0n ? units : null;
}

/** 1_500_000n → "1.5" (trailing zeros dropped, at least "0"). */
export function formatUsdcUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / USDC_UNITS;
  const frac = (abs % USDC_UNITS).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
