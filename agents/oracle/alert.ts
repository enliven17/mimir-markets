/**
 * Operator alerts from the oracle worker (a dispute, a settlement it refused
 * to propose). POSTs `{"text": msg}` to ALERT_WEBHOOK_URL, which Slack
 * incoming webhooks and most Telegram/Discord relays accept as is; without
 * it, or when the POST fails, the message goes to stderr. Never throws.
 */
export async function alert(msg: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  const text = `[mimir-oracle] ${msg}`;
  if (!url) {
    console.error(text);
    return;
  }
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`${text} (alert webhook answered ${res.status})`);
  } catch (err) {
    console.error(`${text} (alert webhook failed: ${err instanceof Error ? err.message : String(err)})`);
  }
}
