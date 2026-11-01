/**
 * Mimir Launch, browser side: a request signed by the owner's wallet (lib/launch/auth.ts). The body is sent exactly as
 * hashed, so the server can check the signature covers it.
 */
import { LAUNCH_HEADERS, launchMessage, type LaunchAction } from "./auth";

/** EIP-191 personal_sign with the connected EVM wallet (useMimirWallet().signMessage): the 0x signature. */
export type SignMessage = (message: string) => Promise<string>;

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signedPost<T>(url: string, a: { owner: string; signMessage: SignMessage; action: LaunchAction; agent: string; body: unknown }): Promise<T> {
  const raw = JSON.stringify(a.body);
  const signedAt = Date.now();
  const message = launchMessage({ action: a.action, owner: a.owner, agent: a.agent, bodySha256: await sha256Hex(raw), signedAt });
  const signature = await a.signMessage(message);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", [LAUNCH_HEADERS.owner]: a.owner, [LAUNCH_HEADERS.signedAt]: String(signedAt), [LAUNCH_HEADERS.signature]: signature },
    body: raw,
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status}).`);
  return out;
}
