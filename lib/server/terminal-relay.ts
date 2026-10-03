/**
 * Send one terminal message to a community agent's endpoint through the
 * SSRF-checked gateway (lib/research/gateway.ts: public hosts only, the DNS
 * answer pinned, no redirects for a POST), signed with the agent's secret.
 */
import { gatewayFetch } from "../research/gateway";
import { MAX_REPLY_CHARS } from "../terminal/chat";
import { parseRelayReply, relaySignature, RELAY_MAX_BYTES, RELAY_TIMEOUT_MS, type RelayPayload } from "../terminal/relay";

export async function relayToAgent(target: { url: string; secret: string }, payload: RelayPayload): Promise<string> {
  const body = JSON.stringify(payload);
  const ts = Date.now();
  const res = await gatewayFetch(target.url, {
    body,
    timeoutMs: RELAY_TIMEOUT_MS,
    maxBytes: RELAY_MAX_BYTES,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain",
      "user-agent": "MimirTerminal/1.0",
      "x-mimir-timestamp": String(ts),
      "x-mimir-signature": relaySignature(target.secret, ts, body),
    },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`the agent answered ${res.status}`);
  if (res.truncated) throw new Error(`the agent's reply is over ${RELAY_MAX_BYTES} bytes`);
  const reply = parseRelayReply(res.body, res.contentType, MAX_REPLY_CHARS);
  if (!reply) throw new Error("the agent sent no reply");
  return reply;
}
