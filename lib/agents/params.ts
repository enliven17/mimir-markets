/**
 * Body validation for the on-chain write actions.
 *
 * Pure (no RPC, no database) so the same checks run for a real call and a
 * dry run, and so they are testable. Limits mirror the program's
 * (onchain/programs/mimir/src/constants.rs): strings are measured in UTF-8
 * bytes because that is what the account space is sized in.
 */
import { ARC } from "../arc/config";
import { AgentEnvelopeError, type AgentWriteAction } from "./api";
import { CATEGORIES } from "../constants";
import { DISPUTE_BOND_UNITS } from "../solana/config";

export const MAX_QUESTION_BYTES = 200;
export const MAX_POSITION_BYTES = 100;
export const MAX_URL_BYTES = 200;
export const MAX_CHALLENGERS = 16;
/** Minimum stake the program accepts, in USDC. */
/** On Arc the contracts' own stake minimum (a deploy parameter); 2 USDC for the Solana program. */
export const MIN_STAKE_USDC = ARC.contracts.mimirV3 ? Number(ARC.contracts.minStakeWei) / 1e18 : 2;
/** A claim must run at least this long, so it cannot be settled before anyone sees it. */
export const MIN_CLAIM_DURATION_SEC = 15 * 60;
export const MAX_CLAIM_DURATION_SEC = 90 * 86_400;

const CATEGORY_IDS: readonly string[] = CATEGORIES.map((c) => c.id);

export interface CreateClaimParams {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  stakeUnits: bigint;
  deadline: number;
  maxChallengers: number;
  /** Also return a delegate_claim transaction so challenges run in the ER. */
  delegate: boolean;
}

export interface ClaimStakeParams {
  claimId: bigint;
  stakeUnits: bigint;
}

export interface ClaimParams {
  claimId: bigint;
}

export interface AmountParams {
  amountUnits: bigint;
}

export type WriteParams =
  | { action: "createClaim"; params: CreateClaimParams }
  | { action: "challenge"; params: ClaimStakeParams }
  | { action: "dispute"; params: ClaimParams }
  | { action: "deposit"; params: AmountParams }
  | { action: "withdraw"; params: AmountParams }
  | { action: "delegateBalance"; params: Record<string, never> }
  | { action: "undelegateBalance"; params: Record<string, never> };

function bad(message: string): never {
  throw new AgentEnvelopeError(message, 400, "bad_params");
}

function text(body: Record<string, unknown>, key: string, maxBytes: number): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim().length === 0) bad(`${key} is required`);
  const trimmed = v.trim();
  if (Buffer.byteLength(trimmed, "utf8") > maxBytes) bad(`${key} is over ${maxBytes} bytes`);
  return trimmed;
}

/** USDC as a decimal number with at most 6 places, to base units. */
export function usdcToUnits(value: unknown, key: string, min = 0): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) bad(`${key} must be a positive number`);
  if (value < min) bad(`${key} must be at least ${min} USDC`);
  if (value > 1_000_000) bad(`${key} is implausibly large`);
  const units = Math.round(value * 1e6);
  if (Math.abs(units / 1e6 - value) > 1e-9) bad(`${key} has more than 6 decimals`);
  return BigInt(units);
}

/** A USDC limit (agent or follower cap) in base units, for exact comparisons. */
export function usdcLimitUnits(usdc: number): bigint {
  return Number.isFinite(usdc) && usdc > 0 ? BigInt(Math.round(usdc * 1e6)) : 0n;
}

export function unitsToUsdc(units: bigint): number {
  return Number(units) / 1e6;
}

export function parseClaimId(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  if (typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)) return BigInt(value);
  bad("claimId must be a positive integer");
}

function httpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    bad("resolutionUrl must be a URL");
  }
  if (url.protocol !== "https:") bad("resolutionUrl must be https");
  return value;
}

export function parseWriteParams(
  action: AgentWriteAction,
  body: Record<string, unknown>,
  nowSec = Math.floor(Date.now() / 1000),
): WriteParams {
  switch (action) {
    case "createClaim": {
      const category = typeof body.category === "string" ? body.category.trim().toLowerCase() : "custom";
      if (!CATEGORY_IDS.includes(category)) bad(`category must be one of ${CATEGORY_IDS.join(", ")}`);
      const deadline = body.deadline;
      if (typeof deadline !== "number" || !Number.isInteger(deadline)) bad("deadline must be unix seconds");
      if (deadline < nowSec + MIN_CLAIM_DURATION_SEC) bad("deadline must be at least 15 minutes out");
      if (deadline > nowSec + MAX_CLAIM_DURATION_SEC) bad("deadline must be within 90 days");
      const maxChallengers = body.maxChallengers ?? MAX_CHALLENGERS;
      if (
        typeof maxChallengers !== "number" ||
        !Number.isInteger(maxChallengers) ||
        maxChallengers < 1 ||
        maxChallengers > MAX_CHALLENGERS
      ) {
        bad(`maxChallengers must be 1-${MAX_CHALLENGERS}`);
      }
      return {
        action,
        params: {
          question: text(body, "question", MAX_QUESTION_BYTES),
          creatorPosition: text(body, "creatorPosition", MAX_POSITION_BYTES),
          counterPosition: text(body, "counterPosition", MAX_POSITION_BYTES),
          resolutionUrl: httpsUrl(text(body, "resolutionUrl", MAX_URL_BYTES)),
          category,
          stakeUnits: usdcToUnits(body.stakeUsdc, "stakeUsdc", MIN_STAKE_USDC),
          deadline,
          maxChallengers,
          delegate: body.delegate !== false,
        },
      };
    }
    case "challenge":
      return {
        action,
        params: {
          claimId: parseClaimId(body.claimId),
          stakeUnits: usdcToUnits(body.stakeUsdc, "stakeUsdc", MIN_STAKE_USDC),
        },
      };
    case "dispute":
      return { action, params: { claimId: parseClaimId(body.claimId) } };
    case "deposit":
    case "withdraw":
      return { action, params: { amountUnits: usdcToUnits(body.amountUsdc, "amountUsdc") } };
    case "delegateBalance":
    case "undelegateBalance":
      return { action, params: {} };
  }
}

/** USDC this write would put at risk: what the position and daily caps count. */
export function stakeOf(parsed: WriteParams): bigint {
  if (parsed.action === "createClaim" || parsed.action === "challenge") return parsed.params.stakeUnits;
  if (parsed.action === "dispute") return DISPUTE_BOND_UNITS;
  return 0n;
}
