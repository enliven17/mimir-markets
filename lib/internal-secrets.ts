/**
 * The shared secrets between the site and the backend, one per purpose, so a leak of one does not open the rest:
 *   store   MIMIR_STORE_SECRET   the site reading and writing the app store (convex/appStore.ts)
 *   events  MIMIR_EVENTS_SECRET  the backend posting market events to /api/telegram/arc-events
 *   admin   MIMIR_ADMIN_SECRET   the site reading the admin overview (convex/arcAdmin.ts)
 * During the rollout each falls back to the old single MIMIR_INTERNAL_SECRET when its own is not set.
 * Shared by Next and Convex (no Node APIs).
 */
export type SecretPurpose = "store" | "events" | "admin";

export const SECRET_ENV: Record<SecretPurpose, string> = {
  store: "MIMIR_STORE_SECRET",
  events: "MIMIR_EVENTS_SECRET",
  admin: "MIMIR_ADMIN_SECRET",
};

type Env = Record<string, string | undefined>;

/** The secret for a purpose ("" when neither it nor the legacy one is set). */
export function internalSecret(purpose: SecretPurpose, env: Env = process.env): string {
  return env[SECRET_ENV[purpose]]?.trim() || env.MIMIR_INTERNAL_SECRET?.trim() || "";
}

/** Constant-time comparison; a secret shorter than 16 characters never matches. */
export function secretMatches(purpose: SecretPurpose, got: string, env: Env = process.env): boolean {
  const want = internalSecret(purpose, env);
  if (want.length < 16 || typeof got !== "string" || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** The app store's tables (lib/server/store.ts callers). Anything else is refused by the backend. */
export const APP_STORE_TABLES = new Set([
  "access_grants",
  "access_invites",
  "access_issuance",
  "admin_nonces",
  "agent_api_keys",
  "agent_api_nonces",
  "agent_api_responses",
  "agent_budget",
  "agent_payments",
  "agent_registry",
  "agent_request_audit",
  "app_meta",
  "arc_accounts",
  "arc_owners",
  "basket_subscriptions",
  "baskets",
  "campaign_codes",
  "campaign_invites",
  "copy_executions",
  "copy_locks",
  "copy_permissions",
  "copy_reservations",
  "rate_limits",
  "telegram_chats",
  "wallet_relay",
]);

/** Only short-lived tables may be pruned in bulk; records that matter (accounts, grants, agents) never are. */
export const PRUNABLE_TABLES = new Set([
  "admin_nonces",
  "agent_api_nonces",
  "agent_api_responses",
  "agent_request_audit",
  "copy_reservations",
  "rate_limits",
  "wallet_relay",
]);
