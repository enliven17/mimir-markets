/**
 * The cheap first step of claim moderation (lib/server/claim-moderation.ts): Jev (lib/jev.ts) picks the policy
 * category a claim falls in, or "none". Only a confident answer decides; the rest go to the full model as before.
 * Off without TYPESAFE_API_KEY: null, no call.
 */
import { ask } from "../jev";
import type { ClaimModerationResult, ClaimModerationViolationCode } from "./sanitize-moderation-result";

/** Allow without the model when Jev puts "none" at or above this. */
export const JEV_ALLOW_AT = 0.97;
/** Block without the model when Jev puts one violation at or above this. */
export const JEV_BLOCK_AT = 0.95;

const VIOLATIONS: Record<ClaimModerationViolationCode, string> = {
  death_self_harm: "betting on someone's death, suicide or self-harm",
  violence_harm: "violence against people, terrorism, sexual assault",
  hate_harassment: "hate, slurs or harassment of a person or group",
  sexual_minors: "anything sexual involving minors",
  nonconsensual_sexual: "non-consensual sexual content about real people",
  illegal_facilitation: "helping commit a crime",
  doxxing_personal_data: "a private person's address, phone, ID or other personal data",
  medical_privacy: "a private person's health",
  graphic_content: "gore or graphic violence",
  other_policy: "anything else a prediction market must not allow",
};

export interface ModerationFields {
  question: string;
  creator_position: string;
  opponent_position: string;
  category: string;
  settlement_rule: string;
  resolution_url: string;
}

export async function jevModeration(input: ModerationFields, policyVersion: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<ClaimModerationResult | null> {
  const state = [
    `Question: ${input.question}`,
    `Creator's side: ${input.creator_position}`,
    `Other side: ${input.opponent_position}`,
    `Category: ${input.category}`,
    `Settlement rule: ${input.settlement_rule}`,
    `Source: ${input.resolution_url}`,
  ].join("\n");
  const a = await ask(state, {
    policy: {
      type: "choice",
      instructions: "Which policy violation does this prediction-market claim contain? Pick none when it is an ordinary question about prices, sports, weather, culture or public events.",
      criteria: { none: "no violation: an ordinary, allowed market", ...VIOLATIONS },
    },
  }, opts);
  if (!a) return null;
  const { choice } = a.policy;
  const p = a.policy.probabilities[choice] ?? a.policy.confidence;
  const version = `jev+${policyVersion}`;
  if (choice === "none" && p >= JEV_ALLOW_AT) return { decision: "allow", violationCodes: [], confidence: Math.round(p * 100), policyVersion: version };
  if (choice !== "none" && p >= JEV_BLOCK_AT) return { decision: "block", violationCodes: [choice], confidence: Math.round(p * 100), policyVersion: version };
  return null;
}
