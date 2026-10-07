/**
 * Telegram chats: who to message, and which wallet each chat follows.
 * Used by the bot (agents/telegram/bot.ts), the indexer (new markets, bet
 * results) and POST /api/telegram/link. No-ops without DATABASE_URL.
 */
import { randomBytes } from "node:crypto";

import { isDbEnabled, query } from "./db";
import {
  ALERT_PREFS,
  isAlertPref,
  LINK_CODE_TTL_MS,
  esc,
  marketButton,
  marketUrlButton,
  newMarketText,
  notificationText,
  prefForKind,
  tg,
  type AlertPref,
  type AlertPrefs,
} from "../telegram";
import type { NotificationEvent } from "../notifications";

export async function upsertChat(chatId: number, now = Date.now()): Promise<void> {
  await query(
    `INSERT INTO telegram_chats (chat_id, created_at) VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET blocked = FALSE`,
    [chatId, now],
  );
}

/** A fresh link code for this chat (replaces any older one). */
export async function newLinkCode(chatId: number, now = Date.now()): Promise<string> {
  const code = randomBytes(18).toString("base64url");
  await upsertChat(chatId, now);
  await query("UPDATE telegram_chats SET link_code = $2, link_expires_at = $3 WHERE chat_id = $1", [
    chatId,
    code,
    now + LINK_CODE_TTL_MS,
  ]);
  return code;
}

/** Redeem a code for a wallet (signature already verified). The chat id, or null when the code is unknown or expired. */
export async function redeemLinkCode(code: string, wallet: string, now = Date.now()): Promise<number | null> {
  const rows = await query<{ chat_id: string }>(
    `UPDATE telegram_chats SET wallet = $2, link_code = NULL, link_expires_at = 0
      WHERE link_code = $1 AND link_expires_at > $3
      RETURNING chat_id`,
    [code, wallet, now],
  );
  return rows[0] ? Number(rows[0].chat_id) : null;
}

export async function chatWallet(chatId: number): Promise<string | null> {
  const rows = await query<{ wallet: string | null }>("SELECT wallet FROM telegram_chats WHERE chat_id = $1", [chatId]);
  return rows[0]?.wallet ?? null;
}

export async function unlinkChat(chatId: number): Promise<void> {
  await query("UPDATE telegram_chats SET wallet = NULL WHERE chat_id = $1", [chatId]);
}

// Column names below only ever come from ALERT_PREFS (checked by isAlertPref), never from user input.
const PREF_COLUMNS = ALERT_PREFS.map((p) => p.key).join(", ");

/** A chat's alert switches (every one on for a chat with no row yet). */
export async function getAlertPrefs(chatId: number): Promise<AlertPrefs> {
  const rows = await query<Record<AlertPref, boolean>>(`SELECT ${PREF_COLUMNS} FROM telegram_chats WHERE chat_id = $1`, [chatId]);
  const row = rows[0];
  return Object.fromEntries(ALERT_PREFS.map((p) => [p.key, row ? row[p.key] !== false : true])) as AlertPrefs;
}

/** Flip one switch; the chat's switches after the change. */
export async function toggleAlertPref(chatId: number, key: string): Promise<AlertPrefs> {
  if (!isAlertPref(key)) throw new Error(`unknown alert ${key}`);
  await upsertChat(chatId);
  await query(`UPDATE telegram_chats SET ${key} = NOT ${key} WHERE chat_id = $1`, [chatId]);
  return getAlertPrefs(chatId);
}

/** Every switch on or off at once (/alerts on, /alerts off). */
export async function setAllAlerts(chatId: number, on: boolean): Promise<void> {
  await upsertChat(chatId);
  await query(`UPDATE telegram_chats SET ${ALERT_PREFS.map((p) => `${p.key} = $2`).join(", ")} WHERE chat_id = $1`, [chatId, on]);
}

async function markBlocked(chatId: number): Promise<void> {
  await query("UPDATE telegram_chats SET blocked = TRUE WHERE chat_id = $1", [chatId]);
}

/** Send, honouring 429 once; a chat that blocked the bot is marked and skipped from then on. */
export async function sendTo(chatId: number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra };
  try {
    await tg("sendMessage", body);
  } catch (err) {
    const e = err as Error & { retryAfter?: number; status?: number };
    if (e.retryAfter) {
      await new Promise((r) => setTimeout(r, (e.retryAfter as number) * 1000));
      await tg("sendMessage", body).catch(() => undefined);
    } else if (e.status === 403) {
      await markBlocked(chatId).catch(() => undefined);
    } else {
      console.warn(`[telegram] send to ${chatId} failed:`, e.message);
    }
  }
}

/** Telegram allows ~30 messages/s per bot: stay well under it. */
const BROADCAST_GAP_MS = 50;

/** New markets to every chat that wants them. */
export async function broadcastNewMarkets(
  markets: Array<{ id: number; question: string; creatorStake: string; deadline: number }>,
): Promise<void> {
  if (!isDbEnabled() || markets.length === 0) return;
  const chats = await query<{ chat_id: string }>("SELECT chat_id FROM telegram_chats WHERE new_markets AND NOT blocked");
  for (const m of markets) {
    for (const c of chats) {
      await sendTo(Number(c.chat_id), newMarketText(m), { reply_markup: marketButton(m.id) });
      await new Promise((r) => setTimeout(r, BROADCAST_GAP_MS));
    }
  }
}

/** A wallet notification (bet result, verdict, payout) to every chat following that wallet and wanting that kind. */
export async function deliverTelegram(e: NotificationEvent): Promise<void> {
  const text = notificationText(e);
  const pref = prefForKind(e.kind);
  if (!text || !pref || !isDbEnabled()) return;
  const chats = await query<{ chat_id: string }>(
    `SELECT chat_id FROM telegram_chats WHERE wallet = $1 AND NOT blocked AND ${pref}`,
    [e.recipient],
  );
  for (const c of chats) await sendTo(Number(c.chat_id), text, { reply_markup: marketButton(e.claimId) });
}

/** A new Arc market to every chat that wants new markets. */
export async function broadcastArcMarket(m: { question: string; stakeA: string; deadline: number; url: string }): Promise<void> {
  if (!isDbEnabled()) return;
  const chats = await query<{ chat_id: string }>("SELECT chat_id FROM telegram_chats WHERE new_markets AND NOT blocked");
  const usdc = (Number(BigInt(m.stakeA) / 10_000_000_000_000n) / 100_000).toFixed(2);
  const text = [
    "🆕 <b>New market</b>",
    esc(m.question),
    "",
    `Opening stake: ${usdc} USDC · closes ${new Date(m.deadline * 1000).toUTCString().replace(":00 GMT", " UTC")}`,
  ].join("\n");
  for (const c of chats) {
    await sendTo(Number(c.chat_id), text, { reply_markup: marketUrlButton(m.url) });
    await new Promise((r) => setTimeout(r, BROADCAST_GAP_MS));
  }
}

/** A personal Arc message to every chat following `wallet` (Solana) that wants this kind. */
export async function deliverArc(wallet: string, text: string, pref: AlertPref, url: string): Promise<void> {
  if (!isDbEnabled()) return;
  const chats = await query<{ chat_id: string }>(`SELECT chat_id FROM telegram_chats WHERE wallet = $1 AND NOT blocked AND ${pref}`, [wallet]);
  for (const c of chats) await sendTo(Number(c.chat_id), text, { reply_markup: marketUrlButton(url) });
}
