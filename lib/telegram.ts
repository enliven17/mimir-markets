/**
 * Telegram bot: Bot API calls and the texts it sends. No SDK: the bot only
 * needs a handful of methods, plain fetch covers them.
 *
 * The bot runs inside the workers process (agents/telegram/bot.ts) with long
 * polling, so it needs no public webhook URL and no extra deployment.
 */
import { SITE_URL } from "./site";
import type { NotificationEvent } from "./notifications";
import { SIDE_CHALLENGERS, SIDE_CREATOR } from "./solana/config";

const API = "https://api.telegram.org";

export function telegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** One Bot API call. Throws on a non-ok answer; `retry_after` (429) is on the error. */
export async function tg<T = unknown>(method: string, body: Record<string, unknown> | FormData, timeoutMs = 15_000): Promise<T> {
  const token = telegramToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "content-type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };
  if (!json.ok) {
    const err = new Error(`telegram ${method}: ${json.description ?? res.status}`) as Error & { retryAfter?: number; status?: number };
    err.retryAfter = json.parameters?.retry_after;
    err.status = res.status;
    throw err;
  }
  return json.result as T;
}

/** The message a wallet signs to link itself to a Telegram chat. */
export function telegramLinkMessage(wallet: string, code: string): string {
  return ["Mimir Telegram link", `Wallet: ${wallet}`, `Code: ${code}`].join("\n");
}

/** Link codes: short-lived, unguessable, URL-safe. */
export const LINK_CODE_TTL_MS = 15 * 60_000;
export const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const linkUrl = (code: string) => `${SITE_URL}/en/telegram?code=${encodeURIComponent(code)}`;
export const claimUrl = (id: number) => `${SITE_URL}/en/arena/${id}`;

/** Escape for parse_mode HTML: claim questions are user text. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const WELCOME_TEXT = [
  "<b>Welcome to Mimir</b>, the AI-settled claim market on Solana.",
  "",
  "Link your wallet and I will message you when:",
  "• a new market opens",
  "• a market you bet on gets a verdict",
  "",
  "/link connect your wallet",
  "/bets your open positions",
  "/price $MIMIR price and stats",
  "/alerts choose which alerts you get",
  "/unlink disconnect your wallet",
].join("\n");

// ── alert preferences (/alerts): one switch per kind, each its own column on telegram_chats
export const ALERT_PREFS = [
  { key: "new_markets", label: "New markets" },
  { key: "alert_results", label: "Results (won, lost, refunded)" },
  { key: "alert_verdicts", label: "Verdicts proposed" },
  { key: "alert_payouts", label: "Payouts ready to claim" },
] as const;
export type AlertPref = (typeof ALERT_PREFS)[number]["key"];
export type AlertPrefs = Record<AlertPref, boolean>;

export function isAlertPref(value: string): value is AlertPref {
  return ALERT_PREFS.some((p) => p.key === value);
}

/** Which switch a wallet notification answers to; null for kinds the bot never forwards. */
export function prefForKind(kind: NotificationEvent["kind"]): AlertPref | null {
  switch (kind) {
    case "resolved":
    case "cancelled":
      return "alert_results";
    case "proposed":
      return "alert_verdicts";
    case "payout_claimable":
      return "alert_payouts";
    default:
      return null;
  }
}

export const ALERTS_TEXT = [
  "<b>Your alerts</b>",
  "Tap to switch one on or off. Results, verdicts and payouts need a linked wallet (/link).",
].join("\n");

/** One toggle button per alert; callback data `alert:<key>`. */
export function alertsKeyboard(prefs: AlertPrefs) {
  return {
    inline_keyboard: ALERT_PREFS.map((p) => [{ text: `${prefs[p.key] ? "✅" : "⬜"} ${p.label}`, callback_data: `alert:${p.key}` }]),
  };
}

const usdc = (units: string | number | bigint) => (Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function newMarketText(c: { id: number; question: string; creatorStake: string; deadline: number }): string {
  return [
    "🆕 <b>New market</b>",
    esc(c.question),
    "",
    `Creator stake: ${usdc(c.creatorStake)} USDC · closes ${new Date(c.deadline * 1000).toUTCString().replace(":00 GMT", " UTC")}`,
  ].join("\n");
}

/** The Telegram text for one wallet notification, or null for kinds the bot does not forward. */
export function notificationText(e: NotificationEvent): string | null {
  const q = esc(String(e.payload.question ?? `Claim #${e.claimId}`));
  switch (e.kind) {
    case "resolved": {
      const side = Number(e.payload.winnerSide);
      const won = e.payload.youWon;
      const head =
        side !== SIDE_CREATOR && side !== SIDE_CHALLENGERS
          ? "↩️ <b>Refunded</b>: no winner, every stake is returned."
          : won === true
            ? "🏆 <b>You won</b>"
            : won === false
              ? "❌ <b>You lost</b>"
              : "✅ <b>Settled</b>";
      const summary = String(e.payload.summary ?? "");
      return [head, q, summary ? `\n<i>${esc(summary)}</i>` : ""].join("\n").trim();
    }
    case "proposed": {
      const until = Number(e.payload.disputableUntil ?? 0);
      const outlook = e.payload.youWinIfFinal === true ? "in your favour" : e.payload.youWinIfFinal === false ? "against you" : "with no winner";
      return [
        `⚖️ <b>Verdict proposed</b> ${outlook}`,
        q,
        until ? `\nDisputable until ${new Date(until * 1000).toUTCString()}` : "",
      ].join("\n").trim();
    }
    case "cancelled":
      return ["🚫 <b>Market cancelled</b>, stakes returned", q].join("\n");
    case "payout_claimable":
      return [`💸 <b>${usdc(String(e.payload.grossUnits ?? "0"))} USDC</b> is ready to claim`, q].join("\n");
    default:
      return null;
  }
}

/** Inline keyboard: open the market (as a Mini App inside Telegram). */
export function marketButton(id: number) {
  return { inline_keyboard: [[{ text: "Open market", web_app: { url: claimUrl(id) } }]] };
}

const compactUsd = (n: number | null) =>
  n === null ? "n/a" : `$${n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}`;

/** /price: the token's live market numbers (DexScreener, display only). */
export function priceText(
  symbol: string,
  s: { priceUsd: number; marketCapUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; change24hPct: number | null },
): string {
  const price = s.priceUsd >= 1 ? s.priceUsd.toFixed(2) : s.priceUsd.toPrecision(4);
  const change = s.change24hPct === null ? "" : ` (${s.change24hPct >= 0 ? "▲" : "▼"} ${Math.abs(s.change24hPct).toFixed(2)}% 24h)`;
  return [
    `<b>$${esc(symbol)}</b> $${price}${change}`,
    "",
    `Market cap: ${compactUsd(s.marketCapUsd)}`,
    `Liquidity: ${compactUsd(s.liquidityUsd)}`,
    `Volume 24h: ${compactUsd(s.volume24hUsd)}`,
  ].join("\n");
}

export const pumpFunUrl = (mint: string) => `https://pump.fun/coin/${mint}`;
