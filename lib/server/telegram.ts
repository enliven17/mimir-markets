/**
 * Telegram chats: who to message, and which wallet each chat follows.
 * Used by the bot (the webhook, lib/server/telegram-bot.ts), the Arc events route and POST /api/telegram/link.
 * Kept in the backend (lib/server/store.ts) as `telegram_chats`: key chat id, i1 the linked wallet, i2 the
 * pending link code. No-ops without the backend.
 */
import { randomBytes } from "node:crypto";

import { store, storeEnabled, update } from "./store";
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

type Chat = {
  chat_id: number;
  wallet: string | null;
  new_markets: boolean;
  link_code: string | null;
  link_expires_at: number;
  blocked: boolean;
  created_at: number;
} & Partial<Record<AlertPref, boolean>>;

const key = (chatId: number) => String(chatId);
const getChat = (chatId: number) => store().get<Chat>("telegram_chats", key(chatId));
const idx = (c: Pick<Chat, "wallet" | "link_code">) => ({ i1: c.wallet ?? undefined, i2: c.link_code ?? undefined });

export async function upsertChat(chatId: number, now = Date.now()): Promise<void> {
  const prev = await getChat(chatId);
  if (prev) {
    if (prev.blocked) await update("telegram_chats", key(chatId), { blocked: false }, undefined, idx(prev));
    return;
  }
  const chat: Chat = { chat_id: chatId, wallet: null, new_markets: true, link_code: null, link_expires_at: 0, blocked: false, created_at: now };
  for (const p of ALERT_PREFS) chat[p.key] = true;
  await store().tx([{ op: "insert", t: "telegram_chats", k: key(chatId), d: chat, at: now }]);
}

async function patchChat(chatId: number, set: Partial<Chat>): Promise<void> {
  const prev = await getChat(chatId);
  if (!prev) return;
  await update("telegram_chats", key(chatId), set, undefined, idx({ ...prev, ...set }));
}

/** A fresh link code for this chat (replaces any older one). */
export async function newLinkCode(chatId: number, now = Date.now()): Promise<string> {
  const code = randomBytes(18).toString("base64url");
  await upsertChat(chatId, now);
  await patchChat(chatId, { link_code: code, link_expires_at: now + LINK_CODE_TTL_MS });
  return code;
}

/** Redeem a code for a wallet (signature already verified). The chat id, or null when the code is unknown or expired. */
export async function redeemLinkCode(code: string, wallet: string, now = Date.now()): Promise<number | null> {
  const [chat] = await store().list<Chat>("telegram_chats", { i2: code, limit: 1 });
  if (!chat || chat.link_code !== code || chat.link_expires_at <= now) return null;
  // Only while the code is still the one on file: a code is redeemed once.
  const ok = await update(
    "telegram_chats",
    key(chat.chat_id),
    { wallet, link_code: null, link_expires_at: 0 },
    { link_code: code },
    { i1: wallet, i2: "" },
  );
  return ok ? Number(chat.chat_id) : null;
}

export async function chatWallet(chatId: number): Promise<string | null> {
  return (await getChat(chatId))?.wallet ?? null;
}

export async function unlinkChat(chatId: number): Promise<void> {
  await patchChat(chatId, { wallet: null });
}

const prefsOf = (chat: Chat | null): AlertPrefs =>
  Object.fromEntries(ALERT_PREFS.map((p) => [p.key, chat ? chat[p.key] !== false : true])) as AlertPrefs;

/** A chat's alert switches (every one on for a chat with no row yet). */
export async function getAlertPrefs(chatId: number): Promise<AlertPrefs> {
  return prefsOf(await getChat(chatId));
}

/** Flip one switch; the chat's switches after the change. */
export async function toggleAlertPref(chatId: number, key: string): Promise<AlertPrefs> {
  if (!isAlertPref(key)) throw new Error(`unknown alert ${key}`);
  await upsertChat(chatId);
  const prefs = await getAlertPrefs(chatId);
  await patchChat(chatId, { [key]: !prefs[key] });
  return getAlertPrefs(chatId);
}

/** Every switch on or off at once (/alerts on, /alerts off). */
export async function setAllAlerts(chatId: number, on: boolean): Promise<void> {
  await upsertChat(chatId);
  await patchChat(chatId, Object.fromEntries(ALERT_PREFS.map((p) => [p.key, on])) as Partial<Chat>);
}

async function markBlocked(chatId: number): Promise<void> {
  await patchChat(chatId, { blocked: true });
}

/** Groups and supergroups (negative chat ids) the bot is still in: where /announce goes. */
export async function groupChatIds(): Promise<number[]> {
  return (await liveChats()).map((c) => Number(c.chat_id)).filter((id) => id < 0);
}

/** Small values the bot keeps (e.g. Telegram's file id of the welcome video). */
export async function getBotMeta(key: string): Promise<string | null> {
  return (await store().get<{ value: string }>("app_meta", key))?.value ?? null;
}

export async function setBotMeta(key: string, value: string, now = Date.now()): Promise<void> {
  await store().tx([{ op: "put", t: "app_meta", k: key, d: { key, value, updated_at: now }, at: now }]);
}

/** Chats that are not blocked, optionally only those following `wallet`. */
async function liveChats(wallet?: string): Promise<Chat[]> {
  const rows = await store().list<Chat>("telegram_chats", wallet !== undefined ? { i1: wallet, limit: 5000 } : { limit: 5000 });
  return rows.filter((c) => !c.blocked && (wallet === undefined || c.wallet === wallet));
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
  if (!storeEnabled() || markets.length === 0) return;
  const chats = (await liveChats()).filter((c) => c.new_markets !== false);
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
  if (!text || !pref || !storeEnabled()) return;
  const chats = (await liveChats(e.recipient)).filter((c) => c[pref] !== false);
  for (const c of chats) await sendTo(Number(c.chat_id), text, { reply_markup: marketButton(e.claimId) });
}

/** A new Arc market to every chat that wants new markets. */
export async function broadcastArcMarket(m: { question: string; stakeA: string; deadline: number; url: string }): Promise<void> {
  if (!storeEnabled()) return;
  const chats = (await liveChats()).filter((c) => c.new_markets !== false);
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
  if (!storeEnabled()) return;
  const chats = (await liveChats(wallet)).filter((c) => c[pref] !== false);
  for (const c of chats) await sendTo(Number(c.chat_id), text, { reply_markup: marketUrlButton(url) });
}
