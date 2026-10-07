/**
 * The Telegram bot by long polling, for running it as a worker (agents/all.ts).
 * On Arc the bot runs on its webhook instead (POST /api/telegram/webhook); a
 * webhook and polling cannot run at once, Telegram answers getUpdates with 409.
 * The handlers live in lib/server/telegram-bot.ts.
 * Needs TELEGRAM_BOT_TOKEN and DATABASE_URL; without either it stays off.
 */
import { isDbEnabled } from "../../lib/server/db";
import { handle, setup, type Update } from "../../lib/server/telegram-bot";
import { telegramToken, tg } from "../../lib/telegram";

const POLL_TIMEOUT_S = 25;

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
