import { NextResponse } from "next/server";

import { MAX_POSITION_BYTES, MAX_QUESTION_BYTES, MAX_URL_BYTES } from "@/lib/agents/params";
import { createApiError } from "@/lib/server/api-validation";
import { readLimitedJson } from "@/lib/server/body-limit";
import {
  getGlobalCooldownMs,
  hashModerationInput,
  moderationInFlight,
  moderationResultCache,
  setGlobalCooldownMs,
} from "@/lib/server/moderation-cache";

export type ClaimModerationInput = {
  question: string;
  creator_position: string;
  opponent_position: string;
  category: string;
  settlement_rule: string;
  resolution_url: string;
};

export type ClaimModerationResult = {
  decision: "allow" | "review" | "block";
  violationCodes: string[];
  confidence: number;
  policyVersion: string;
};

type ModerationRequestBody = {
  locale?: unknown;
  input?: unknown;
};

/**
 * Per-field byte caps: the on-chain limits (onchain constants MAX_QUESTION,
 * MAX_POSITION, MAX_URL, MAX_CATEGORY) plus a bound on the off-chain rule
 * text, so a claim that could never be created cannot buy an LLM call.
 */
export const MODERATION_FIELD_MAX_BYTES: Record<keyof ClaimModerationInput, number> = {
  question: MAX_QUESTION_BYTES,
  creator_position: MAX_POSITION_BYTES,
  opponent_position: MAX_POSITION_BYTES,
  category: 32,
  settlement_rule: 1_000,
  resolution_url: MAX_URL_BYTES,
};

/** The first field over its cap, or null. */
export function oversizedModerationField(input: ClaimModerationInput): keyof ClaimModerationInput | null {
  for (const key of Object.keys(MODERATION_FIELD_MAX_BYTES) as Array<keyof ClaimModerationInput>) {
    if (Buffer.byteLength(input[key].trim(), "utf8") > MODERATION_FIELD_MAX_BYTES[key]) return key;
  }
  return null;
}

function parseInput(value: unknown): ClaimModerationInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const question = typeof row.question === "string" ? row.question : "";
  const creator_position =
    typeof row.creator_position === "string" ? row.creator_position : "";
  const opponent_position =
    typeof row.opponent_position === "string" ? row.opponent_position : "";
  const category = typeof row.category === "string" ? row.category : "";
  const settlement_rule =
    typeof row.settlement_rule === "string" ? row.settlement_rule : "";
  const resolution_url =
    typeof row.resolution_url === "string" ? row.resolution_url : "";

  if (
    !question.trim() ||
    !creator_position.trim() ||
    !opponent_position.trim() ||
    !category.trim() ||
    !settlement_rule.trim() ||
    !resolution_url.trim()
  ) {
    return null;
  }

  return {
    question,
    creator_position,
    opponent_position,
    category,
    settlement_rule,
    resolution_url,
  };
}

export async function handleClaimModerationPost(args: {
  request: Request;
  moderateClaim: (input: { input: ClaimModerationInput; locale: string }) => Promise<ClaimModerationResult>;
}) {
  if (process.env.NEXT_PUBLIC_FEATURE_CLAIM_MODERATION !== "1") {
    return NextResponse.json(
      createApiError("feature_disabled", "Claim moderation is not enabled"),
      { status: 404 }
    );
  }

  try {
    const read = await readLimitedJson(args.request);
    if (!read.ok) {
      return NextResponse.json(
        createApiError(read.status === 413 ? "payload_too_large" : "invalid_request",
          read.status === 413 ? "Request body is too large" : "Request body must be valid JSON"),
        { status: read.status }
      );
    }
    const body = (read.value && typeof read.value === "object" ? read.value : {}) as ModerationRequestBody;
    const locale = typeof body.locale === "string" ? body.locale.trim().slice(0, 16) : "en";
    const input = parseInput(body.input);

    if (!input) {
      return NextResponse.json(
        createApiError("invalid_request", "input is required"),
        { status: 400 }
      );
    }
    const oversized = oversizedModerationField(input);
    if (oversized) {
      return NextResponse.json(
        createApiError("invalid_request", `${oversized} is over ${MODERATION_FIELD_MAX_BYTES[oversized]} bytes`),
        { status: 400 }
      );
    }

    const cooldownMs = getGlobalCooldownMs();
    if (cooldownMs > 0) {
      const seconds = Math.max(1, Math.ceil(cooldownMs / 1000));
      return NextResponse.json(
        createApiError(
          "claim_moderation_rate_limited",
          `Moderation is rate-limited. Retry in ${seconds}s.`
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(seconds),
          },
        }
      );
    }

    const key = hashModerationInput({ locale, input });
    const cached = moderationResultCache.get(key);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          "X-Moderation-Cache": "HIT",
        },
      });
    }

    const existing = moderationInFlight.get(key);
    if (existing) {
      const result = await existing;
      return NextResponse.json(result, {
        headers: {
          "X-Moderation-Dedupe": "INFLIGHT",
        },
      });
    }

    const p = args
      .moderateClaim({ input, locale })
      .then((result) => {
        const ttlMs =
          result.decision === "allow" ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000;
        moderationResultCache.set(key, result, ttlMs);
        return result;
      })
      .finally(() => {
        moderationInFlight.delete(key);
      });

    moderationInFlight.set(key, p);
    const result = await p;
    return NextResponse.json(result, {
      headers: {
        "X-Moderation-Cache": "MISS",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to moderate claim";
    const isRateLimited =
      /request failed\s*\(429\)|RESOURCE_EXHAUSTED|quota|rate limit/i.test(
        message
      );
    if (isRateLimited) {
      setGlobalCooldownMs(35_000);
    }
    const status = /not configured|not enabled/i.test(message)
      ? 503
      : isRateLimited
        ? 429
        : 500;

    const headers: Record<string, string> = {};
    if (isRateLimited) {
      headers["Retry-After"] = "35";
    }
    if (status === 500) console.error("[claim-moderation] failed:", error);
    // Only the messages this module writes itself reach the client.
    const clientMessage =
      status === 500 ? "Unable to moderate claim right now" : message;
    return NextResponse.json(createApiError("claim_moderation_error", clientMessage), {
      status,
      headers,
    });
  }
}

