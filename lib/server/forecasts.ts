/**
 * Forecast log for the calibration page. Not `server-only`: the council and
 * oracle workers write here. One row per (claim, forecaster); a re-evaluation
 * keeps the first forecast, the one made furthest from the outcome.
 * Best-effort: without DATABASE_URL nothing is recorded.
 */
import { isDbEnabled, query } from "./db";
import { MIMIR_PROGRAM_ID } from "../solana/config";
import type { ScoredForecast } from "../calibration";

const PROGRAM = () => MIMIR_PROGRAM_ID.toBase58();

export async function recordForecast(args: {
  claimId: number;
  forecaster: string;
  pChallengers: number;
  verdict: string;
  confidence: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  await query(
    `INSERT INTO forecasts (program, claim_id, forecaster, p_challengers, verdict, confidence, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (program, claim_id, forecaster) DO NOTHING`,
    [PROGRAM(), args.claimId, args.forecaster, args.pChallengers, args.verdict, Math.round(args.confidence), Date.now()],
  );
}

/** Forecasts on claims that RESOLVED on a side (1 creator, 2 challengers), with that side. */
export async function scoredForecasts(): Promise<ScoredForecast[]> {
  if (!isDbEnabled()) return [];
  const rows = await query<{ forecaster: string; p_challengers: number; winner_side: number }>(
    `SELECT f.forecaster, f.p_challengers, c.winner_side
       FROM forecasts f
       JOIN solana_claims c ON c.program = f.program AND c.id = f.claim_id
      WHERE f.program = $1 AND c.state = 2 AND c.winner_side IN (1, 2)`,
    [PROGRAM()],
  );
  return rows.map((r) => ({
    forecaster: String(r.forecaster),
    pChallengers: Number(r.p_challengers),
    winnerSide: Number(r.winner_side) === 2 ? "challengers" : "creator",
  }));
}
