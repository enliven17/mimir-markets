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
 * Version 2 (Proof of Reasoning): the committed hash is a Merkle root over
 * four fixed steps instead of one flat sha256, so a Sentinel can prove which
 * step it disputes without revealing or re-hashing the rest:
 *   0 spec      what was asked (claim, program, ids, time)
 *   1 collector what was read (evidence + its content receipt, deadline prices)
 *   2 auditor   how it was reasoned (resolver, council, model, raw verdict)
 *   3 judge     what was decided (every adjustment, the final verdict)
 * leaf = sha256(0x00 ‖ canonicalJson(step)), node = sha256(0x01 ‖ left ‖ right).
 * Version 1 bundles keep their flat sha256.
 *
 * Pure: hashing and canonical form only. Storage is lib/server/verdict-bundles.ts.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const VERDICT_BUNDLE_VERSION = 2;

export interface VerdictBundle {
  version: 1 | 2;
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
  /** sha256 is the content receipt of the text as read (v2), fetchedAt when it was read. */
  evidence?: { fetcher: string; text: string; sha256?: string; fetchedAt?: number };
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

/** Lowercase hex, no 0x: how hashes are keyed and displayed (v2 bundles: the PoR root). */
export function bundleHash(bundle: unknown): string {
  const b = bundle as VerdictBundle | null;
  return b && typeof b === "object" && b.version >= 2 ? bytesToHex(porRoot(b)) : bytesToHex(sha256Bytes(canonicalJson(bundle)));
}

export function hashHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

export const POR_STEPS = ["spec", "collector", "auditor", "judge"] as const;
export type PorStep = (typeof POR_STEPS)[number];

/** The four Proof-of-Reasoning steps of a bundle, in leaf order. */
export function porSteps(b: VerdictBundle): Record<PorStep, unknown> {
  const { version, program, claimId, decidedAt, claim, evidence, prices, resolver, council, model, rawVerdict, ...judge } = b;
  return {
    spec: { version, program, claimId, decidedAt, claim },
    collector: { evidence, prices },
    auditor: { resolver, council, model, rawVerdict },
    // Everything else (adjustments, finalVerdict, and any field added later such as lateDepositPolicy) is the judge's,
    // so no key of the bundle is ever left out of the root.
    judge,
  };
}

const tagged = (tag: number, ...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(1 + parts.reduce((n, p) => n + p.length, 0));
  out[0] = tag;
  let o = 1;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return sha256(out);
};

/** Leaf hash of one step's content. */
export const porLeaf = (step: unknown): Uint8Array => tagged(0, utf8ToBytes(canonicalJson(step)));
const node = (l: Uint8Array, r: Uint8Array): Uint8Array => tagged(1, l, r);

/** The Merkle root committed on chain for a v2 bundle. */
export function porRoot(b: VerdictBundle): Uint8Array {
  const [a, c, d, e] = POR_STEPS.map((k) => porLeaf(porSteps(b)[k]));
  return node(node(a, c), node(d, e));
}

/** Sibling hashes (hex, bottom-up) proving one step against the root. */
export function porProof(b: VerdictBundle, step: PorStep): string[] {
  const leaves = POR_STEPS.map((k) => porLeaf(porSteps(b)[k]));
  const i = POR_STEPS.indexOf(step);
  const pair = i < 2 ? node(leaves[2], leaves[3]) : node(leaves[0], leaves[1]);
  return [bytesToHex(leaves[i ^ 1]), bytesToHex(pair)];
}

/** True when `content` is exactly step `step` of the bundle committed as `rootHex`. */
export function verifyPorStep(step: PorStep, content: unknown, proof: string[], rootHex: string): boolean {
  const i = POR_STEPS.indexOf(step);
  if (i < 0 || proof.length !== 2) return false;
  const [sib, pair] = proof.map((h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));
  const leaf = porLeaf(content);
  const lower = i % 2 === 0 ? node(leaf, sib) : node(sib, leaf);
  const root = i < 2 ? node(lower, pair) : node(pair, lower);
  return bytesToHex(root) === rootHex.replace(/^0x/, "").toLowerCase();
}

/** A bundle as it is stored and served, with the hash that goes on chain (v2: the PoR root; v1: flat sha256). */
export function sealBundle(bundle: VerdictBundle): { canonical: string; hash: string; bytes: Uint8Array } {
  const canonical = canonicalJson(bundle);
  const bytes = bundle.version >= 2 ? porRoot(bundle) : sha256Bytes(canonical);
  return { canonical, hash: bytesToHex(bytes), bytes };
}
