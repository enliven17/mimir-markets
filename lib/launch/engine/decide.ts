// One entry decision: candidates → hard rules → LLM scores → best above threshold → size.
// Rules are re-applied here on purpose: a score for a mint that did not pass is ignored, so the
// ranker can reorder but never let anything through.
import type { Condition } from "../types";
import type { Candidate } from "../ports";
import { passingCandidates } from "./rules";
import { entrySize } from "./sizing";
import type { SizeInput } from "./sizing";
import { fmtSol, isPrice, label, WSOL_MINT } from "./sol";

export const DEFAULT_THRESHOLD = 0.6;

export type BuyIntent = {
  mint: string;
  symbol: string;
  lamports: bigint;
  priceSol: number;
  score: number;
  why: string;
  source: Candidate["source"];
};

export type Line = { kind: "rules" | "score" | "hold"; text: string };

export type DecideInput = {
  candidates: readonly Candidate[];
  conditions: readonly Condition[];
  scores: ReadonlyMap<string, { score: number; why: string }>;
  threshold?: number;
  /** Mints never to buy (e.g. the agent's own token). */
  exclude?: readonly string[];
  sizing: Omit<SizeInput, "mint">;
};

export type DecideResult = { intent: BuyIntent | null; lines: Line[]; pause: boolean };

export function decide(input: DecideInput): DecideResult {
  const threshold = Number.isFinite(input.threshold) ? (input.threshold as number) : DEFAULT_THRESHOLD;
  const held = new Set(input.sizing.openPositions.map((p) => p.mint));
  const banned = new Set([WSOL_MINT, ...(input.exclude ?? [])]);
  const lines: Line[] = [];

  const passing = passingCandidates(input.candidates, input.conditions).filter((c) => !banned.has(c.mint));
  if (passing.length === 0) return { intent: null, lines: [{ kind: "rules", text: "no token passed the entry rules" }], pause: false };

  const ranked = passing
    .filter((c) => !held.has(c.mint) && isPrice(c.priceSol))
    .map((c) => ({ c, s: input.scores.get(c.mint) }))
    .filter((x): x is { c: Candidate; s: { score: number; why: string } } => !!x.s && Number.isFinite(x.s.score))
    .sort((a, b) => b.s.score - a.s.score);

  if (ranked.length === 0) {
    return { intent: null, lines: [{ kind: "score", text: `${passing.length} passed rules but none could be scored or priced, skipping` }], pause: false };
  }
  const best = ranked[0];
  const name = label(best.c.symbol, best.c.mint);
  lines.push({ kind: "score", text: `top pick ${name} scored ${best.s.score.toFixed(2)}${best.s.why ? `: ${best.s.why}` : ""}` });
  if (best.s.score < threshold) {
    lines.push({ kind: "hold", text: `best score ${best.s.score.toFixed(2)} below threshold ${threshold}, no entry` });
    return { intent: null, lines, pause: false };
  }

  const size = entrySize({ ...input.sizing, mint: best.c.mint });
  if (size.lamports === 0n) {
    lines.push({ kind: "rules", text: `no entry on ${name}: ${size.reason}` });
    return { intent: null, lines, pause: size.pause };
  }
  lines.push({ kind: "rules", text: `sizing ${name}: ${fmtSol(size.lamports)} SOL (${size.reason})` });
  return {
    intent: {
      mint: best.c.mint,
      symbol: best.c.symbol,
      lamports: size.lamports,
      priceSol: best.c.priceSol as number,
      score: best.s.score,
      why: best.s.why,
      source: best.c.source,
    },
    lines,
    pause: false,
  };
}
