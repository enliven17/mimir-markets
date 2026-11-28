/**
 * The Sentinel's audit of one oracle proposal: deterministic checks only, no model. A Sentinel is any Binance
 * Agent ID holder; on BSC the contracts let it dispute without a position (contracts/MimirV3Erc20.sol _isSentinel).
 *
 * It checks, against what is on chain:
 *   1. the published bundle re-hashes to the committed Proof-of-Reasoning root (lib/verdict-bundle.ts);
 *   2. the Collector's content receipt matches the evidence text;
 *   3. the spec step is the claim people staked on (question, source, deadline);
 *   4. the Judge's final verdict is the side proposed on chain;
 *   5. for a price claim, independent deadline prices (fetched by the runner) do not contradict that side.
 * Any fault is a reason to dispute. Pure.
 */
import { consensusWinner, crossCheckThreshold, type PriceReading } from "../../lib/price-consensus";
import { bundleHash, hashHex, sha256Bytes, type VerdictBundle } from "../../lib/verdict-bundle";

export const SIDE = { CREATOR_WINS: 1, CHALLENGERS_WIN: 2, DRAW: 3, UNRESOLVABLE: 4 } as const;

export interface Proposal {
  side: number;
  /** 0x-prefixed bytes32 from the ResolutionProposed event. */
  evidenceHash: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  deadline: number;
}

export function auditProposal(p: Proposal, bundle: VerdictBundle | null, independentPrices: PriceReading[] = []): string[] {
  // A zero hash is the one-sided refund (no bundle, nothing decided): nothing to audit or dispute.
  if (/^(0x)?0{64}$/i.test(p.evidenceHash)) return [];
  if (!bundle?.claim || !bundle.finalVerdict) return ["no audit bundle is published for the committed hash"];
  const faults: string[] = [];
  if (bundleHash(bundle) !== p.evidenceHash.replace(/^0x/, "").toLowerCase()) faults.push("bundle does not re-hash to the on-chain evidenceHash");
  const ev = bundle.evidence;
  if (ev?.sha256 && hashHex(sha256Bytes(ev.text)) !== ev.sha256) faults.push("evidence text does not match its content receipt");
  const c = bundle.claim;
  if (c.question !== p.question || c.resolutionUrl !== p.resolutionUrl || c.deadline !== p.deadline) faults.push("spec step is not the claim on chain");
  const decided = SIDE[bundle.finalVerdict.verdict as keyof typeof SIDE];
  if (decided !== p.side) faults.push(`judge decided ${bundle.finalVerdict.verdict} but side ${p.side} was proposed`);
  if (bundle.prices && independentPrices.length >= 2 && (p.side === SIDE.CREATOR_WINS || p.side === SIDE.CHALLENGERS_WIN)) {
    const check = crossCheckThreshold(independentPrices, bundle.prices.threshold, p.deadline * 1000);
    const winner = consensusWinner(p.question, p.creatorPosition, p.counterPosition, check.verdict);
    if (winner && SIDE[winner] !== p.side) faults.push(`independent deadline prices say ${winner}`);
  }
  return faults;
}
