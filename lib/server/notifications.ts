/**
 * Storage and webhook delivery for notification events (lib/notifications.ts).
 *
 * Used by the indexer worker (record + deliver) and the /api/notifications
 * routes (list, set webhook). Everything degrades to a no-op without
 * DATABASE_URL.
 */
import { createHmac, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";

import { isDbEnabled, query } from "./db";
import { MIMIR_PROGRAM_ID } from "../solana/config";
import {
  isRetryableStatus,
  WEBHOOK_RETRY_DELAYS_MS,
  type ClaimSnapshot,
  type NotificationEvent,
} from "../notifications";
import { assertHopAllowed, publicOnlyLookup } from "../research/gateway";
import { createDeliveryQueue } from "./webhook-queue";
import { deliverTelegram } from "./telegram";
import { telegramToken } from "../telegram";

const PROGRAM = () => MIMIR_PROGRAM_ID.toBase58();
const DELIVERY_TIMEOUT_MS = 5_000;

/** Deliveries run in the background: max 4 in flight, per-URL breaker (webhook-queue.ts). */
const deliveries = createDeliveryQueue({ concurrency: 4 });

export interface StoredNotification {
  id: number;
  claimId: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

/**
 * The previous snapshot of every indexed claim, read once per indexer cycle so
 * each re-read claim can be diffed against what the index held before.
 */
export async function loadClaimSnapshots(): Promise<Map<number, ClaimSnapshot>> {
  const out = new Map<number, ClaimSnapshot>();
  if (!isDbEnabled()) return out;
  const rows = await query<Record<string, unknown>>(
    `SELECT id, creator, question, state, winner_side, proposed_side, disputable_until, disputer,
            resolution_summary, confidence, creator_stake, total_challenger_stake, creator_paid, challengers
       FROM solana_claims WHERE program = $1`,
    [PROGRAM()],
  );
  for (const r of rows) {
    const challengers = typeof r.challengers === "string" ? JSON.parse(r.challengers) : r.challengers;
    out.set(Number(r.id), {
      id: Number(r.id),
      creator: String(r.creator),
      question: String(r.question ?? ""),
      state: Number(r.state),
      winner_side: Number(r.winner_side),
      proposed_side: Number(r.proposed_side ?? 0),
      disputable_until: Number(r.disputable_until ?? 0),
      disputer: String(r.disputer ?? ""),
      resolution_summary: String(r.resolution_summary ?? ""),
      confidence: Number(r.confidence ?? 0),
      creator_stake: String(r.creator_stake ?? "0"),
      total_challenger_stake: String(r.total_challenger_stake ?? "0"),
      creator_paid: Boolean(r.creator_paid),
      challengers: Array.isArray(challengers) ? challengers : [],
    });
  }
  return out;
}

/**
 * Store events (idempotently: the unique key drops repeats when a claim is
 * re-read) and push the newly stored ones to their recipient's webhook.
 * Returns how many were new.
 */
export async function recordNotifications(events: NotificationEvent[], now = Date.now()): Promise<number> {
  if (!isDbEnabled() || events.length === 0) return 0;
  let fresh = 0;
  for (const e of events) {
    const inserted = await query(
      `INSERT INTO notifications (program, recipient, claim_id, kind, dedupe, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (program, recipient, claim_id, kind, dedupe) DO NOTHING
       RETURNING id`,
      [PROGRAM(), e.recipient, e.claimId, e.kind, e.dedupe, JSON.stringify(e.payload), now],
    );
    if (inserted.length === 0) continue;
    fresh++;
    if (telegramToken()) {
      await deliverTelegram(e).catch((err) =>
        console.warn("[notifications] telegram delivery failed:", err instanceof Error ? err.message : String(err)),
      );
    }
    // Queued, not awaited: a slow or dead receiver must not stall the indexer.
    await deliverWebhook(e, Number(inserted[0].id), now).catch((err) =>
      console.warn("[notifications] webhook lookup failed:", err instanceof Error ? err.message : String(err)),
    );
  }
  return fresh;
}

export async function listNotifications(recipient: string, limit = 30): Promise<StoredNotification[]> {
  if (!isDbEnabled()) return [];
  const rows = await query<Record<string, unknown>>(
    `SELECT id, claim_id, kind, payload, created_at FROM notifications
      WHERE program = $1 AND recipient = $2
      ORDER BY created_at DESC, id DESC LIMIT $3`,
    [PROGRAM(), recipient, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(r.payload)) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    return {
      id: Number(r.id),
      claimId: Number(r.claim_id),
      kind: String(r.kind),
      payload,
      createdAt: Number(r.created_at),
    };
  });
}

export type SetWebhookResult = { ok: true; secret: string | null } | { ok: false; reason: "stale" };

/**
 * Set (or with url "" remove) a wallet's webhook. A removal keeps a tombstone
 * row so an older signed registration cannot be replayed over it: a
 * registration only applies when its signedAt is newer than the stored one.
 * Returns the new signing secret (null on removal).
 */
export async function setWebhook(address: string, url: string, signedAt: number, now = Date.now()): Promise<SetWebhookResult> {
  const secret = url ? randomBytes(24).toString("base64url") : "";
  const rows = await query(
    `INSERT INTO notification_webhooks (address, url, secret, signed_at, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (address) DO UPDATE
       SET url = excluded.url, secret = excluded.secret, signed_at = excluded.signed_at, created_at = excluded.created_at
       WHERE notification_webhooks.signed_at < excluded.signed_at
     RETURNING address`,
    [address, url, secret, signedAt, now],
  );
  if (rows.length === 0) return { ok: false, reason: "stale" };
  return { ok: true, secret: url ? secret : null };
}

/** HMAC-SHA256 of the raw body, as sent in `x-mimir-signature: sha256=<hex>`. */
export function webhookSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * One POST, no redirects, socket pinned to the validated public address (the
 * same lookup the evidence gateway uses, so DNS rebinding cannot swap the
 * target after the check). Resolves to the status, null on a network error.
 */
async function postOnce(rawUrl: string, body: string, headers: Record<string, string>): Promise<number | null> {
  const url = await assertHopAllowed(rawUrl);
  if (url.protocol !== "https:") return 0;
  return new Promise((resolve) => {
    let settled = false;
    const done = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString(), ...headers },
        lookup: publicOnlyLookup as never,
      },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), DELIVERY_TIMEOUT_MS);
    req.on("error", () => done(null));
    req.end(body);
  });
}

/**
 * Queue the event for the recipient's webhook, if any. Delivery POSTs it with
 * `x-mimir-signature: sha256=<hmac>` over the raw body, keyed by the secret
 * handed out at registration: at most three attempts, retrying only network
 * errors, 429 and 5xx. The event id header lets a receiver drop a repeat.
 * Only the webhook lookup is awaited.
 */
async function deliverWebhook(e: NotificationEvent, id: number, now: number): Promise<void> {
  const rows = await query<{ url: string; secret: string }>(
    "SELECT url, secret FROM notification_webhooks WHERE address = $1",
    [e.recipient],
  );
  const hook = rows[0];
  if (!hook?.url) return;
  const body = JSON.stringify({ id, event: e.kind, claimId: e.claimId, recipient: e.recipient, payload: e.payload, at: now });
  const headers = { "x-mimir-signature": webhookSignature(hook.secret, body), "x-mimir-event-id": String(id) };
  if (!deliveries.enqueue(hook.url, () => postWithRetries(hook.url, body, headers))) {
    console.warn(`[notifications] webhook skipped for event ${id}: receiver failing or queue full`);
  }
}

async function postWithRetries(url: string, body: string, headers: Record<string, string>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const status = await postOnce(url, body, headers);
    if (status !== null && status >= 200 && status < 300) return;
    const delay = WEBHOOK_RETRY_DELAYS_MS[attempt];
    if (delay === undefined || !isRetryableStatus(status)) {
      throw new Error(`gave up after ${attempt + 1} attempt(s), last status ${status ?? "network error"}`);
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}
