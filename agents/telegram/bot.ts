/**
 * Telegram bot (@mimirmarketsbot), run inside the workers process
 * (agents/all.ts) with long polling: no webhook URL, no extra deployment.
 *
 *   /start   launch video, what the bot does, link + open-app buttons
 *   /link    a one-time link: the wallet signs it on the site (/telegram)
 *   /bets    the linked wallet's live positions
 *   /price   $MIMIR price, market cap, liquidity, volume + pump.fun link
 *   /alerts  a switch per alert (new markets, results, verdicts, payouts); on|off sets them all
 *   /unlink  stop following the wallet
 *
 * The menu button opens the site as a Telegram Mini App. Messages for new
 * markets and bet results are sent by the indexer (lib/server/telegram.ts).
 * Needs TELEGRAM_BOT_TOKEN and DATABASE_URL; without either it stays off.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { claimsChallengedBy, claimsCreatedBy } from "../../lib/agents/store";
import { fetchDexStats } from "../../lib/server/dex-prices";
import { mimirMint, mimirSymbol } from "../../lib/token-config";
import { getMeta, isDbEnabled, query, setMeta } from "../../lib/server/db";
import {
  chatWallet,
  getAlertPrefs,
  newLinkCode,
  sendTo,
  setAllAlerts,
  toggleAlertPref,
  unlinkChat,
  upsertChat,
} from "../../lib/server/telegram";
import { isLiveState } from "../../lib/solana/config";
import { SITE_URL } from "../../lib/site";
import {
  ALERTS_TEXT,
  alertsKeyboard,
  claimUrl,
  esc,
  linkUrl,
  priceText,
  pumpFunUrl,
  telegramToken,
  tg,
  WELCOME_TEXT,
} from "../../lib/telegram";

const VIDEO_PATH = path.join(process.cwd(), "brand", "launch.mp4");
const THUMB_PATH = path.join(process.cwd(), "brand", "launch-thumb.jpg");
// Telegram sizes the bubble from these, not from the file: without them a 16:9 clip shows in a square bubble.
const VIDEO_DIMS = { width: 1920, height: 1080, duration: 20 };
// v2: the v1 upload carried no dimensions, and a file_id keeps whatever it was uploaded with.
const VIDEO_META_KEY = "telegram_launch_video_file_id_v2";
const POLL_TIMEOUT_S = 25;

interface Update {
  update_id: number;
  message?: { chat: { id: number; type: string }; from?: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number; type: string } } };
  my_chat_member?: { chat: { id: number; type: string }; new_chat_member: { status: string } };
}

/**
 * Added to a group or channel: it gets new-market alerts, nothing else (no
 * wallet is ever linked there, so results, verdicts and payouts never reach it).
 * Removed: the next send hits a 403 and marks the chat blocked.
 */
async function onMembership(m: NonNullable<Update["my_chat_member"]>): Promise<void> {
  if (m.chat.type === "private") return;
  if (["member", "administrator"].includes(m.new_chat_member.status)) {
    await upsertChat(m.chat.id);
    await sendTo(m.chat.id, "Mimir is here. New markets will be posted in this chat as they open.");
  }
}

/** A tap on an /alerts switch: flip it and redraw the buttons in place. */
async function onAlertTap(q: NonNullable<Update["callback_query"]>): Promise<void> {
  const msg = q.message;
  const key = q.data?.startsWith("alert:") ? q.data.slice("alert:".length) : null;
  if (!msg || msg.chat.type !== "private" || !key) {
    await tg("answerCallbackQuery", { callback_query_id: q.id });
    return;
  }
  const prefs = await toggleAlertPref(msg.chat.id, key);
  await tg("editMessageReplyMarkup", { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: alertsKeyboard(prefs) });
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Saved" });
}

/** $MIMIR on mainnet (README); NEXT_PUBLIC_MIMIR_TOKEN_MINT overrides it. */
const MIMIR_MINT = mimirMint() ?? "8r2Lgeg2aJzekpg1vLRJ2BoNUGKXqvH11Ab74eRPjd4V";

/** Telegram refuses web_app buttons outside private chats, so groups get the same page as a plain link. */
const pageButton = (text: string, url: string, group: boolean) => (group ? { text, url } : { text, web_app: { url } });

async function onPrice(chatId: number, group = false): Promise<void> {
  const stats = await fetchDexStats(MIMIR_MINT);
  const links = [
    [{ text: "pump.fun", url: pumpFunUrl(MIMIR_MINT) }, ...(stats?.pairUrl ? [{ text: "DexScreener", url: stats.pairUrl }] : [])],
    [pageButton("Token perks", `${SITE_URL}/en/token`, group)],
  ];
  const text = stats ? priceText(mimirSymbol(), stats) : `${esc(mimirSymbol())} price is unavailable right now.`;
  await sendTo(chatId, `${text}

<code>${MIMIR_MINT}</code>`, { reply_markup: { inline_keyboard: links } });
}

const appButton = { text: "Open Mimir", web_app: { url: `${SITE_URL}/en` } };

async function linkButtons(chatId: number) {
  const code = await newLinkCode(chatId);
  // A plain URL, not a Mini App: wallet apps (Phantom, Solflare) connect from the browser.
  return { inline_keyboard: [[{ text: "🔗 Link wallet", url: linkUrl(code) }], [appButton]] };
}

/** The launch video: uploaded once, then re-sent by file_id. */
async function sendLaunchVideo(chatId: number): Promise<void> {
  const cached = await getMeta(VIDEO_META_KEY).catch(() => null);
  if (cached) {
    await tg("sendVideo", { chat_id: chatId, video: cached, supports_streaming: true, ...VIDEO_DIMS });
    return;
  }
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("supports_streaming", "true");
  for (const [k, v] of Object.entries(VIDEO_DIMS)) form.append(k, String(v));
  form.append("video", new Blob([await readFile(VIDEO_PATH)], { type: "video/mp4" }), "mimir.mp4");
  form.append("thumbnail", new Blob([await readFile(THUMB_PATH)], { type: "image/jpeg" }), "thumb.jpg");
  const sent = await tg<{ video?: { file_id: string } }>("sendVideo", form, 120_000);
  if (sent.video?.file_id) await setMeta(VIDEO_META_KEY, sent.video.file_id).catch(() => undefined);
}

async function onStart(chatId: number): Promise<void> {
  await upsertChat(chatId);
  await sendLaunchVideo(chatId).catch((err) => console.warn("[telegram] launch video failed:", err?.message ?? err));
  const wallet = await chatWallet(chatId);
  const linked = wallet ? `\n\nLinked wallet: <code>${esc(wallet)}</code>` : "";
  await sendTo(chatId, WELCOME_TEXT + linked, { reply_markup: wallet ? { inline_keyboard: [[appButton]] } : await linkButtons(chatId) });
}

async function onBets(chatId: number): Promise<void> {
  const wallet = await chatWallet(chatId);
  if (!wallet) {
    await sendTo(chatId, "No wallet linked yet.", { reply_markup: await linkButtons(chatId) });
    return;
  }
  const [created, challenged] = await Promise.all([claimsCreatedBy(wallet, 50), claimsChallengedBy(wallet, 50)]);
  const live = [...created.map((c) => ({ ...c, side: "creator" })), ...challenged.map((c) => ({ ...c, side: "challenger" }))]
    .filter((c) => isLiveState(c.state))
    .sort((a, b) => a.deadline - b.deadline)
    .slice(0, 15);
  if (live.length === 0) {
    await sendTo(chatId, "No open positions for this wallet.", { reply_markup: { inline_keyboard: [[appButton]] } });
    return;
  }
  const lines = live.map(
    (c) => `• <a href="${claimUrl(c.id)}">#${c.id}</a> ${c.side}, ${(Number(c.stake) / 1e6).toFixed(2)} USDC, closes ${new Date(c.deadline * 1000).toUTCString().slice(5, 22)} UTC`,
  );
  await sendTo(chatId, ["<b>Your open positions</b>", ...lines].join("\n"));
}

/** Telegram user ids allowed to /announce (TELEGRAM_ADMIN_IDS, comma-separated). Empty = nobody. */
const ADMIN_IDS = new Set((process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));

/**
 * /announce <text>: an admin, in a private chat with the bot, posts <text> to
 * every group the bot is in (a tweet link unfurls into its preview there).
 * Anyone else gets the welcome, as for any unknown command.
 */
async function onAnnounce(chatId: number, fromId: number | undefined, raw: string): Promise<boolean> {
  if (fromId === undefined || !ADMIN_IDS.has(String(fromId))) return false;
  const body = raw.replace(/^\/announce(@\w+)?\s*/i, "").trim();
  if (!body) {
    await sendTo(chatId, "Usage: /announce <text or a tweet link>. It goes to every group the bot is in.");
    return true;
  }
  // Groups and supergroups have negative chat ids; private chats never get announcements.
  const groups = await query<{ chat_id: string }>("SELECT chat_id FROM telegram_chats WHERE chat_id < 0 AND NOT blocked");
  for (const g of groups) {
    await sendTo(Number(g.chat_id), esc(body), { disable_web_page_preview: false });
    await new Promise((r) => setTimeout(r, 50));
  }
  await sendTo(chatId, `Sent to ${groups.length} group${groups.length === 1 ? "" : "s"}.`);
  return true;
}

async function handle(update: Update): Promise<void> {
  if (update.callback_query) return onAlertTap(update.callback_query);
  if (update.my_chat_member) return onMembership(update.my_chat_member);
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return handleGroup(chatId, msg.text);
  const [command, arg] = msg.text.trim().split(/\s+/, 2);
  if (command.split("@")[0].toLowerCase() === "/announce" && (await onAnnounce(chatId, msg.from?.id, msg.text))) return;
  if (await onPublic(chatId, command.split("@")[0].toLowerCase())) return;
  switch (command.split("@")[0].toLowerCase()) {
    case "/start":
      return onStart(chatId);
    case "/link":
      await upsertChat(chatId);
      return sendTo(chatId, "Open the link, connect your wallet and sign. It is valid for 15 minutes.", {
        reply_markup: await linkButtons(chatId),
      });
    case "/bets":
      return onBets(chatId);
    case "/price":
      return onPrice(chatId);
    case "/alerts": {
      const all = (arg ?? "").toLowerCase();
      if (all === "on" || all === "off") await setAllAlerts(chatId, all === "on");
      else await upsertChat(chatId);
      return sendTo(chatId, ALERTS_TEXT, { reply_markup: alertsKeyboard(await getAlertPrefs(chatId)) });
    }
    case "/app":
      return sendTo(chatId, "Open Mimir right here in Telegram.", { reply_markup: { inline_keyboard: [[appButton]] } });
    case "/unlink":
      await unlinkChat(chatId);
      return sendTo(chatId, "Wallet unlinked. /link to connect one again.");
    default:
      return sendTo(chatId, WELCOME_TEXT);
  }
}

/**
 * The campaign top 10, read from the site's own API so it matches the page
 * (house wallets are filtered there, with the site's env).
 */
async function onLeaderboard(chatId: number): Promise<void> {
  const page = `${SITE_URL}/en/campaign`;
  const button = { reply_markup: { inline_keyboard: [[{ text: "Full leaderboard", url: page }]] } };
  let rows: Array<{ wallet: string; score: number; early?: boolean }>;
  try {
    const res = await fetch(`${SITE_URL}/api/campaign`, { signal: AbortSignal.timeout(15_000) });
    rows = ((await res.json()) as { rows?: typeof rows }).rows ?? [];
  } catch {
    await sendTo(chatId, "The leaderboard is unavailable right now.", button);
    return;
  }
  const medal = ["🥇", "🥈", "🥉"];
  const lines = rows.slice(0, 10).map(
    (r, i) => `${medal[i] ?? `${i + 1}.`} <code>${r.wallet.slice(0, 4)}…${r.wallet.slice(-4)}</code>  ${r.score.toLocaleString("en-US")} pts${r.early ? "  ⚡ early" : ""}`,
  );
  await sendTo(
    chatId,
    ["<b>Testnet campaign · top 10</b>", "", ...(lines.length ? lines : ["No points yet. Stake on devnet to be first."])].join("\n"),
    button,
  );
}

/** /ca, /website and /leaderboard: the same public answer in private chats and groups. */
async function onPublic(chatId: number, command: string): Promise<boolean> {
  if (command === "/ca") {
    await sendTo(chatId, `<b>${esc(mimirSymbol())} contract address</b> (Solana)
<code>${MIMIR_MINT}</code>`, {
      reply_markup: { inline_keyboard: [[{ text: "pump.fun", url: pumpFunUrl(MIMIR_MINT) }]] },
    });
    return true;
  }
  if (command === "/leaderboard") {
    await onLeaderboard(chatId);
    return true;
  }
  if (command === "/website") {
    await sendTo(chatId, SITE_URL, { reply_markup: { inline_keyboard: [[{ text: "Open mimirmarkets.xyz", url: SITE_URL }]] } });
    return true;
  }
  return false;
}

/** In a group only the public commands answer; wallet, bets and alerts stay in private chats. */
async function handleGroup(chatId: number, text: string): Promise<void> {
  const command = text.trim().split(/\s+/, 1)[0].split("@")[0].toLowerCase();
  if (await onPublic(chatId, command)) return;
  switch (command) {
    case "/price":
      return onPrice(chatId, true);
    case "/app":
    case "/start":
      return sendTo(chatId, "<b>Mimir</b>: AI-settled claim markets on Solana. Stake a side, AI agents and an oracle settle it.", {
        reply_markup: { inline_keyboard: [[pageButton("Open Mimir", `${SITE_URL}/en`, true)]] },
      });
  }
}

async function setup(): Promise<void> {
  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "What this bot does" },
      { command: "link", description: "Link your wallet" },
      { command: "bets", description: "Your open positions" },
      { command: "price", description: "$MIMIR price and stats" },
      { command: "app", description: "Open Mimir" },
      { command: "ca", description: "$MIMIR contract address" },
      { command: "leaderboard", description: "Testnet campaign top 10" },
      { command: "website", description: "mimirmarkets.xyz" },
      { command: "alerts", description: "Choose which alerts you get" },
      { command: "unlink", description: "Unlink your wallet" },
    ],
  });
  // The chat's menu button opens the site as a Mini App.
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Open Mimir", web_app: { url: `${SITE_URL}/en` } } });
}

async function main(): Promise<void> {
  if (!telegramToken()) return console.log("[telegram] TELEGRAM_BOT_TOKEN not set, bot off.");
  if (!isDbEnabled()) return console.log("[telegram] DATABASE_URL not set, bot off.");
  await setup().catch((err) => console.warn("[telegram] setup failed:", err?.message ?? err));
  console.log("[telegram] bot polling");
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg<Update[]>(
        "getUpdates",
        { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ["message", "callback_query", "my_chat_member"] },
        (POLL_TIMEOUT_S + 10) * 1000,
      );
      for (const u of updates) {
        offset = u.update_id + 1;
        await handle(u).catch((err) => console.warn("[telegram] update failed:", err?.message ?? err));
      }
    } catch (err) {
      // 409: another process polls with the same token (e.g. a local run next to Railway).
      const e = err as Error & { status?: number };
      console.warn("[telegram] getUpdates failed:", e.message);
      await new Promise((r) => setTimeout(r, e.status === 409 ? 30_000 : 5_000));
    }
  }
}

main().catch((err) => console.error("[telegram] stopped:", err));
