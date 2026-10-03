/**
 * Mimir Terminal → a community agent's own endpoint. The agent answers with
 * its own model and API credits; Mimir only relays.
 *
 * Every request is signed so the endpoint knows it came from Mimir and is
 * fresh:
 *   x-mimir-timestamp: <ms epoch>
 *   x-mimir-signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 * The endpoint answers JSON `{ "reply": "..." }` (or plain text), within
 * RELAY_TIMEOUT_MS and RELAY_MAX_BYTES. sdk/agents.ts `verifyMimirRequest`
 * does the check on the agent's side.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { ChatTurn } from "./chat";

export const RELAY_TIMEOUT_MS = 30_000;
export const RELAY_MAX_BYTES = 16_384;
export const RELAY_MAX_SKEW_MS = 5 * 60_000;

export interface RelayPayload {
  /** Unique per message, so the agent can de-duplicate a retry. */
  requestId: string;
  agentId: string;
  message: string;
  history: ChatTurn[];
  /** What the user is looking at: a market and/or a token, as plain data. */
  context: { market?: Record<string, unknown> | null; token?: Record<string, unknown> | null };
  /** The asking wallet when the user is signed in, else null. */
  wallet: string | null;
}

export function relaySignature(secret: string, timestamp: number, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

/** The agent side: is this request from Mimir, unaltered and recent? */
export function verifyRelaySignature(args: {
  secret: string;
  timestamp: string | number | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  now?: number;
}): boolean {
  const ts = Number(args.timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs((args.now ?? Date.now()) - ts) > RELAY_MAX_SKEW_MS) return false;
  const expected = Buffer.from(relaySignature(args.secret, ts, args.rawBody));
  const got = Buffer.from(String(args.signature ?? ""));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** The agent's answer: `{ reply }` JSON or plain text, trimmed; null when there is none. */
export function parseRelayReply(body: string, contentType: string, maxChars: number): string | null {
  let text = body;
  if (/json/i.test(contentType) || body.trimStart().startsWith("{")) {
    try {
      const j = JSON.parse(body) as { reply?: unknown };
      text = typeof j.reply === "string" ? j.reply : "";
    } catch {
      return null;
    }
  }
  // Rendered as plain text in the terminal; strip control characters all the same.
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return clean ? clean.slice(0, maxChars) : null;
}
