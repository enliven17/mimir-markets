/**
 * The local first step of claim moderation: obvious disallowed topics blocked without any model call. Shared by the
 * web route (lib/server/claim-moderation.ts) and the backend's twin reconciler (convex/arcTwins.ts), which re-checks
 * a user's market before Mimir opens its twin on another chain. Pure.
 */
import type { ClaimModerationViolationCode } from "./sanitize-moderation-result";

export const LOCAL_BLOCK_PATTERNS: Array<{
  code: ClaimModerationViolationCode;
  re: RegExp;
}> = [
  // Death / self-harm (ES/EN light coverage)
  {
    code: "death_self_harm",
    re: /\b(suicid|suicidarse|autolesi|self[-\s]?harm|kill\s+myself)\b/i,
  },
  {
    code: "death_self_harm",
    re: /\b(morir|muere|muerte|asesin|mat[ao]n|killed|die|death|murder)\b/i,
  },
  // Violence / harm
  {
    code: "violence_harm",
    re: /\b(violaci|rape|raped|abuse|abus(?:o|ar)|golpear|disparar|shoot|stab|bomb|terror)\b/i,
  },
  // Doxxing / personal data
  {
    code: "doxxing_personal_data",
    re: /\b(doxx|doxxing|direcci[oó]n|domicilio|tel[eé]fono|dni|passport|ssn)\b/i,
  },
];

/** The first local rule a claim's text breaks, or null. */
export function localBlock(text: string): ClaimModerationViolationCode | null {
  for (const p of LOCAL_BLOCK_PATTERNS) if (p.re.test(text)) return p.code;
  return null;
}
