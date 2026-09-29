/**
 * Granting a copy permission: form values → signed draft → POST body → draft.
 *
 * The follower signs `copyPermissionMessage(draft)` and the server rebuilds
 * the draft from the POST body before verifying. If the two differ by one
 * character the signature fails, so the route parses its body with
 * `copyDraftFromBody`, the same function the tests round-trip through, and
 * the body the page POSTs is derived from the very draft that was signed.
 *
 * Pure: shared by the page, the route and the SDK.
 */
import { CATEGORIES } from "./constants";
import {
  COPY_ID_PATTERN,
  InvalidCopyPermissionError,
  validateCopyPermission,
  type CopyPermission,
} from "./copy-trading";

export { COPY_ID_PATTERN };

export type CopyDraft = Omit<CopyPermission, "signature" | "createdAt">;

export const COPY_CATEGORIES = CATEGORIES.map((c) => c.id);
export type CopyCategory = (typeof COPY_CATEGORIES)[number];

/** Raw form values: everything a text input produces is a string. */
export interface CopyFormValues {
  id: string;
  signalAgentId: string;
  executionAgentId: string;
  maxPerPositionUsdc: string;
  maxDailyUsdc: string;
  maxWeeklyUsdc: string;
  maxOpenExposureUsdc: string;
  maxRealizedLossUsdc: string;
  allowedCategories: string[];
  minClaimQuality: string;
  minPayoutRatio: string;
  /** `YYYY-MM-DD` from a date input. */
  expiresOn: string;
}

export const DEFAULT_COPY_FORM: CopyFormValues = {
  id: "",
  signalAgentId: "",
  executionAgentId: "",
  maxPerPositionUsdc: "2",
  maxDailyUsdc: "10",
  maxWeeklyUsdc: "40",
  maxOpenExposureUsdc: "20",
  maxRealizedLossUsdc: "10",
  allowedCategories: [],
  minClaimQuality: "60",
  minPayoutRatio: "1.2",
  expiresOn: "",
};

function numberOr(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The permission ends at the last second of the chosen day, local time. */
export function expiresAtFromDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const ms = new Date(`${date}T23:59:59`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** `YYYY-MM-DD` for a date `days` from `now`, local time (date input format). */
export function dateInputValue(now: number, days: number): string {
  const d = new Date(now + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A readable, valid permission id: "copy-statistician-via-my-agent-k3x9".
 * The suffix keeps a second grant for the same pair from overwriting the first.
 */
export function suggestCopyId(signalAgentId: string, executionAgentId: string, suffix: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const tail = slug(suffix) || "0";
  const parts = ["copy", slug(signalAgentId), "via", slug(executionAgentId)].filter(Boolean);
  const head = parts.join("-").slice(0, 63 - tail.length - 1).replace(/-+$/, "");
  return `${head}-${tail}`;
}

export function buildCopyDraft(values: CopyFormValues, follower: string, signedAt: number): CopyDraft {
  return {
    id: values.id.trim(),
    // Base58 is case-sensitive: the key goes in exactly as the wallet reports it.
    follower,
    signalAgentId: values.signalAgentId.trim(),
    executionAgentId: values.executionAgentId.trim(),
    active: true,
    expiresAt: expiresAtFromDate(values.expiresOn),
    maxPerPositionUsdc: numberOr(values.maxPerPositionUsdc, 0),
    maxDailyUsdc: numberOr(values.maxDailyUsdc, 0),
    maxWeeklyUsdc: numberOr(values.maxWeeklyUsdc, 0),
    maxOpenExposureUsdc: numberOr(values.maxOpenExposureUsdc, 0),
    maxRealizedLossUsdc: numberOr(values.maxRealizedLossUsdc, 0),
    // Stable order so the signed text does not depend on click order.
    allowedCategories: COPY_CATEGORIES.filter((c) => values.allowedCategories.includes(c)),
    minClaimQuality: numberOr(values.minClaimQuality, 0),
    minPayoutRatio: numberOr(values.minPayoutRatio, 1),
    signedAt,
  };
}

/** The server's parse of a grant body. `follower` is the already-normalized key. */
export function copyDraftFromBody(body: Record<string, unknown>, follower: string): CopyDraft {
  return {
    id: String(body.id ?? "").trim(),
    follower,
    signalAgentId: String(body.signalAgentId ?? "").trim(),
    executionAgentId: String(body.executionAgentId ?? "").trim(),
    active: true,
    expiresAt: numberOr(body.expiresAt, 0),
    maxPerPositionUsdc: numberOr(body.maxPerPositionUsdc, 0),
    maxDailyUsdc: numberOr(body.maxDailyUsdc, 0),
    maxWeeklyUsdc: numberOr(body.maxWeeklyUsdc, 0),
    maxOpenExposureUsdc: numberOr(body.maxOpenExposureUsdc, 0),
    maxRealizedLossUsdc: numberOr(body.maxRealizedLossUsdc, 0),
    allowedCategories: stringList(body.allowedCategories),
    minClaimQuality: numberOr(body.minClaimQuality, 0),
    minPayoutRatio: numberOr(body.minPayoutRatio, 1),
    signedAt: numberOr(body.signedAt, 0),
  };
}

/** The first problem the server would reject the draft for, or null. */
export function copyDraftError(draft: CopyDraft, now = Date.now()): string | null {
  if (!COPY_ID_PATTERN.test(draft.id)) {
    return "id must be 3-64 chars of [a-z0-9-], starting alphanumeric";
  }
  const unknown = draft.allowedCategories.filter((c) => !(COPY_CATEGORIES as readonly string[]).includes(c));
  if (unknown.length > 0) return `unknown category: ${unknown.join(", ")}`;
  try {
    validateCopyPermission({ ...draft, signature: "", createdAt: now }, now);
    return null;
  } catch (err) {
    if (err instanceof InvalidCopyPermissionError) return err.message;
    throw err;
  }
}

/** The POST body for a signed draft. */
export function copyGrantBody(draft: CopyDraft, signature: string): Record<string, unknown> {
  return { ...draft, signature };
}
