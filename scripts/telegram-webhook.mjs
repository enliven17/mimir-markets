// Point the Telegram bot at the site's webhook, or back to long polling.
//   node --env-file=.env.local scripts/telegram-webhook.mjs set https://mimirmarkets.xyz
//   node --env-file=.env.local scripts/telegram-webhook.mjs delete      (the polling worker can run again)
//   node --env-file=.env.local scripts/telegram-webhook.mjs info
// Needs TELEGRAM_BOT_TOKEN and, for set, TELEGRAM_WEBHOOK_SECRET (16+ chars, the same value on Vercel).
const [cmd, site] = process.argv.slice(2)
const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
const call = async (method, body = {}) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}
if (cmd === 'set') {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  if (!site || !secret || secret.length < 16) throw new Error('usage: set <https://site>, with TELEGRAM_WEBHOOK_SECRET (16+ chars)')
  console.log(await call('setWebhook', { url: `${site.replace(/\/$/, '')}/api/telegram/webhook`, secret_token: secret, allowed_updates: ['message', 'callback_query', 'my_chat_member'], drop_pending_updates: false }))
} else if (cmd === 'delete') {
  console.log(await call('deleteWebhook'))
} else {
  const info = await call('getWebhookInfo')
  console.log({ ...info.result, url: info.result?.url || '(none: long polling)' })
}
