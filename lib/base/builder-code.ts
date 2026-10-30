/**
 * Base Builder Codes (ERC-8021): a data suffix appended to a transaction's calldata so Base attributes it to Mimir.
 * Contracts ignore trailing calldata, so the suffix changes nothing on chain except a few gas (16 per non-zero byte).
 *
 * Schema 0 (what base.dev issues): codes as ASCII joined by ",", then 1 byte codes length, 1 byte schema id (0),
 * then the 16-byte ERC marker 0x8021 repeated. Same bytes as ox `Attribution.toDataSuffix({ codes })`.
 * Docs: https://docs.base.org/base-chain/quickstart/builder-codes, https://eip.tools/eip/8021
 *
 * BASE_BUILDER_CODE takes either the code from base.dev (e.g. "bc_b7k3p9da") or the already-encoded hex suffix that
 * the dashboard also shows; unset or invalid means no suffix (never an error: attribution must not break a send).
 */
import type { Hex } from "viem";

export const ERC8021_MARKER = "80218021802180218021802180218021";

/** The schema 0 suffix for one or more codes (printable ASCII, no commas; at most 255 bytes together). */
export function builderCodeSuffix(codes: string[]): Hex {
  if (!codes.length || codes.some((c) => !/^[\x21-\x2b\x2d-\x7e]+$/.test(c))) throw new Error("builder codes are printable ASCII without commas");
  const joined = codes.join(",");
  if (joined.length > 255) throw new Error("builder codes are at most 255 bytes");
  const hex = Array.from(joined, (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return `0x${hex}${joined.length.toString(16).padStart(2, "0")}00${ERC8021_MARKER}`;
}

/** The suffix from env: a raw code, or a pre-encoded hex suffix ending in the ERC-8021 marker. Null when unset/bad. */
export function builderSuffixFromEnv(raw: string | undefined): Hex | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^0x([0-9a-fA-F]{2})+$/.test(v)) return v.toLowerCase().endsWith(ERC8021_MARKER) ? (v.toLowerCase() as Hex) : null;
  try {
    return builderCodeSuffix([v]);
  } catch {
    return null;
  }
}

/**
 * Calldata with the suffix appended. A plain ETH send ("0x") stays plain: to a smart-wallet payee, calldata would hit
 * its fallback instead of its receive, which may revert.
 */
export function withBuilderSuffix(data: Hex, suffix: Hex | null): Hex {
  return suffix && data !== "0x" ? (`${data}${suffix.slice(2)}` as Hex) : data;
}
