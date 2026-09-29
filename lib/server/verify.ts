import "server-only";

import { Keypair } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import { MIMIR_PROGRAM_ID, ST_RESOLVED, isSettlingState } from "@/lib/solana/config";
import { bundleHash, hashHex, type VerdictBundle } from "@/lib/verdict-bundle";
import { getVerdictBundleText } from "@/lib/server/verdict-bundles";
import { cachedFor } from "@/lib/server/ttl-cache";

export interface VerificationReport {
  program: string;
  claimId: number;
  found: boolean;
  /** RESOLVED on chain (final). */
  resolved: boolean;
  /** A verdict is on chain: PROPOSED, DISPUTED or RESOLVED. */
  hasVerdict: boolean;
  onChain: {
    state: number;
    winnerSide: number;
    proposedSide: number;
    confidence: number;
    summary: string;
    /** Lowercase hex, null when all zeros (nothing committed). */
    evidenceHash: string | null;
  } | null;
  /** Canonical JSON exactly as hashed, for anyone who wants to hash it themselves. */
  bundleText: string | null;
  bundle: VerdictBundle | null;
  recomputedHash: string | null;
  /** The stored bundle hashes to the on-chain evidence_hash. */
  matches: boolean;
}

let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

/**
 * Check a claim's on-chain evidence_hash against the stored audit bundle. The
 * hash is recomputed here from the stored text, never trusted from the row.
 */
async function verify(claimId: number): Promise<VerificationReport> {
  const program = MIMIR_PROGRAM_ID.toBase58();
  const empty: VerificationReport = {
    program, claimId, found: false, resolved: false, hasVerdict: false, onChain: null,
    bundleText: null, bundle: null, recomputedHash: null, matches: false,
  };
  const claim = await getReader().getClaim(BigInt(claimId));
  if (!claim) return empty;

  const committed = claim.evidenceHash.some((b) => b !== 0) ? hashHex(claim.evidenceHash) : null;
  const onChain = {
    state: claim.state,
    winnerSide: claim.winnerSide,
    proposedSide: claim.proposedSide,
    confidence: claim.confidence,
    summary: claim.resolutionSummary,
    evidenceHash: committed,
  };
  const report: VerificationReport = {
    ...empty,
    found: true,
    resolved: claim.state === ST_RESOLVED,
    hasVerdict: isSettlingState(claim.state),
    onChain,
  };
  if (!committed) return report;

  const text = await getVerdictBundleText(committed).catch(() => null);
  if (!text) return report;
  let bundle: VerdictBundle | null = null;
  try {
    bundle = JSON.parse(text) as VerdictBundle;
  } catch {
    bundle = null;
  }
  const recomputedHash = bundle ? bundleHash(bundle) : null;
  return { ...report, bundleText: text, bundle, recomputedHash, matches: recomputedHash === committed };
}

/** Cached briefly per instance: the page and its raw download share one chain read. */
export const verifyClaim = cachedFor(verify, 10_000);
