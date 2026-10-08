/**
 * POST /api/telegram/link   bind a Telegram chat to a wallet
 *   body: { code, wallet, signature }
 *
 * `code` comes from the bot's /link button (one-time, 15 min). The wallet
 * signs telegramLinkMessage(wallet, code) (ed25519, base58 signature), so
 * nobody can follow a wallet they do not hold. The chat then gets a
 * confirmation from the bot.
 */
import { accessDenied } from "@/lib/server/access";
import { NextResponse } from "next/server";

import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { readLimitedJson } from "@/lib/server/body-limit";
import { storeEnabled } from "@/lib/server/store";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { redeemLinkCode, sendTo } from "@/lib/server/telegram";
import { esc, LINK_CODE_PATTERN, telegramLinkMessage, telegramToken } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await allowRequest("telegram-link", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  const read = await readLimitedJson(req);
  if (!read.ok || !read.value || typeof read.value !== "object") {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: read.ok ? 400 : read.status });
  }
  const body = read.value as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code : "";
  const wallet = normalizeAddress(body.wallet);
  if (!LINK_CODE_PATTERN.test(code) || !wallet) {
    return NextResponse.json({ error: "code and wallet are required" }, { status: 400 });
  }
  if (!verifyAgentSignature({ address: wallet, message: telegramLinkMessage(wallet, code), signature: String(body.signature ?? "") })) {
    return NextResponse.json({ error: "signature does not match" }, { status: 401 });
  }
  if (!storeEnabled()) return NextResponse.json({ error: "telegram linking is not configured" }, { status: 503 });
  const denied = await accessDenied(wallet);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  try {
    const chatId = await redeemLinkCode(code, wallet);
    if (chatId === null) {
      return NextResponse.json({ error: "this link expired: send /link to the bot for a new one" }, { status: 410 });
    }
    if (telegramToken()) {
      await sendTo(chatId, `✅ Wallet linked: <code>${esc(wallet)}</code>\nYou will hear about your bets here. /bets lists them.`);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "could not link the wallet" }, { status: 500 });
  }
}
