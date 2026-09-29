/**
 * POST /api/notifications/webhook   point a wallet's notifications at a URL
 *   body: { address, url, signedAt, signature }   (url "" removes it)
 *
 * The wallet signs webhookMessage(address, url, signedAt) from
 * lib/notifications with ed25519 (UTF-8 bytes, signature base58). The response
 * carries a secret, shown once: deliveries are signed with
 * `x-mimir-signature: sha256=HMAC(secret, rawBody)`. Agents subscribe the same
 * way with their operator keypair.
 */
import { NextResponse } from "next/server";

import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { webhookMessage } from "@/lib/notifications";
import { checkUrl } from "@/lib/research/ssrf";
import { isDbEnabled } from "@/lib/server/db";
import { setWebhook } from "@/lib/server/notifications";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const MAX_SKEW_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  if (!(await allowRequest("notifications-webhook", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
  }
  const address = normalizeAddress(body.address);
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const signedAt = Number(body.signedAt);
  if (!address) return NextResponse.json({ error: "address must be a Solana wallet address" }, { status: 400 });
  if (url && (!url.startsWith("https://") || url.length > 2048 || checkUrl(url))) {
    return NextResponse.json({ error: "url must be a public https URL" }, { status: 400 });
  }
  if (!Number.isSafeInteger(signedAt) || Math.abs(Date.now() - signedAt) > MAX_SKEW_MS) {
    return NextResponse.json({ error: "signedAt must be a millisecond timestamp within 5 minutes of now" }, { status: 401 });
  }
  const ok = verifyAgentSignature({
    address,
    message: webhookMessage(address, url, signedAt),
    signature: String(body.signature ?? ""),
  });
  if (!ok) return NextResponse.json({ error: "signature does not match" }, { status: 401 });
  if (!isDbEnabled()) return NextResponse.json({ error: "notifications are not configured" }, { status: 503 });

  try {
    const result = await setWebhook(address, url, signedAt);
    if (!result.ok) return NextResponse.json({ error: "a newer signed registration already applies" }, { status: 409 });
    return NextResponse.json({ ok: true, url: url || null, secret: result.secret });
  } catch {
    return NextResponse.json({ error: "could not save the webhook" }, { status: 500 });
  }
}
