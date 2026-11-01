/**
 * Forecast log of the council and the oracle. Not `server-only`: the workers
 * write here. One row per (claim, forecaster); a re-evaluation
 * keeps the first forecast, the one made furthest from the outcome.
 * Best-effort: without DATABASE_URL nothing is recorded.
 */
import { isDbEnabled, query } from "./db";

/** Rows are keyed by the market contract they belong to. */
const PROGRAM = () => (process.env.NEXT_PUBLIC_MIMIR_V3_ADDRESS ?? "").trim().toLowerCase();

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
