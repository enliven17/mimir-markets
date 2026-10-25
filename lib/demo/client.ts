import bs58 from "bs58";
import { PREVIEW_OWNER_HEADER, previewWalletMessage } from "./auth";
import { LAUNCH_HEADERS } from "../launch/auth";
import type { SignMessage } from "../launch/client";

export function demoGet(owner: string, agentId?: string) {
  return fetch(agentId ? `/api/demo?agent=${encodeURIComponent(agentId)}` : "/api/demo", { cache: "no-store", headers: { [PREVIEW_OWNER_HEADER]: owner } });
}
export async function authorizePreview(owner: string, signMessage: SignMessage) {
  const signedAt = Date.now();
  const signature = bs58.encode(await signMessage(new TextEncoder().encode(previewWalletMessage(owner, signedAt))));
  return demoPost({ action: "session" }, owner, { [LAUNCH_HEADERS.signedAt]: String(signedAt), [LAUNCH_HEADERS.signature]: signature });
}
export async function demoPost<T = { ok: boolean }>(body: unknown, owner: string, headers: Record<string, string> = {}): Promise<T> {
  if (!owner) throw new Error("Connect your wallet first.");
  const response = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json", [PREVIEW_OWNER_HEADER]: owner, ...headers }, body: JSON.stringify(body) });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Preview request failed.");
  return result;
}
