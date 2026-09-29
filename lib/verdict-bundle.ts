/**
 * Verdict audit bundles.
 *
 * Everything the oracle used to decide a claim, in one JSON document: the
 * claim as it read it, the evidence text and how it was fetched, the price
 * readings at the deadline, the structured resolver result, the council's
 * votes, the model that answered, and every adjustment between the raw and
 * the final verdict. The claim's on-chain `evidence_hash` ([u8; 32]) is the
 * SHA-256 of the bundle's canonical JSON, so anyone holding the bundle can
 * check that it is exactly what the oracle committed to, and nothing was
 * added afterwards (`sha256sum bundle.json`).
 *
 * Pure: hashing and canonical form only. Storage is lib/server/verdict-bundles.ts.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const VERDICT_BUNDLE_VERSION = 1;

export interface VerdictBundle {
  version: typeof VERDICT_BUNDLE_VERSION;
  /** Program id (base58): claim ids restart at 1 on a redeploy. */
  program: string;
  claimId: number;
  decidedAt: number;
  claim: {
    question: string;
    creatorPosition: string;
    counterPosition: string;
    resolutionUrl: string;
    category: string;
    deadline: number;
  };
  evidence?: { fetcher: string; text: string };
  prices?: { symbol: string; threshold: number; readings: Array<{ source: string; priceUsd: number; at: number }> };
  resolver?: { spec: unknown; detail: string };
  council?: {
    tally: unknown;
    votes: Array<{ slug: string; verdict: string; confidence: number }>;
    /** Personas left off the jury because they hold a position. */
    excluded?: string[];
    qHistory?: number[];
    referenceQ?: number;
  };
  model?: string;
  rawVerdict?: { verdict: string; confidence: number; explanation: string };
  adjustments: string[];
  finalVerdict: { verdict: string; confidence: number; explanation: string };
}

/** Sorted keys, compact, no undefined: the one byte sequence that is hashed. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 of text as 32 bytes (what `evidence_hash` stores). */
export function sha256Bytes(text: string): Uint8Array {
  return sha256(utf8ToBytes(text));
}

/** Lowercase hex, no 0x: how hashes are keyed and displayed. */
export function bundleHash(bundle: unknown): string {
  return bytesToHex(sha256Bytes(canonicalJson(bundle)));
}

export function hashHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/** A bundle as it is stored and served, with the hash that goes on chain. */
export function sealBundle(bundle: VerdictBundle): { canonical: string; hash: string; bytes: Uint8Array } {
  const canonical = canonicalJson(bundle);
  const bytes = sha256Bytes(canonical);
  return { canonical, hash: bytesToHex(bytes), bytes };
}
