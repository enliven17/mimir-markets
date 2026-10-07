/**
 * POST /api/telegram/webhook: Telegram delivers every bot update here (set with
 * scripts/telegram-webhook.mjs). Telegram signs each call with the secret we
 * registered (X-Telegram-Bot-Api-Secret-Token); anything else is refused.
 * Always answers 200 once the update is handled or failed, so Telegram does
 * not redeliver a command that already ran.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { handle, type Update } from "@/lib/server/telegram-bot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return secret.length >= 16 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return NextResponse.json({ ok: true });
  }
  await handle(update).catch((err) => console.warn("[telegram] update failed:", err instanceof Error ? err.message : err));
  return NextResponse.json({ ok: true });
}
