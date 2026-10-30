// Mimir Launch, server side: read a signed owner request (lib/launch/auth.ts) and the backend client.
import "server-only";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";

import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { internalSecret } from "@/lib/internal-secrets";
import { readLimitedText } from "@/lib/server/body-limit";
import { allowRequest } from "@/lib/server/rate-limit";
import { isFreshLaunchSig, LAUNCH_HEADERS, LAUNCH_SIG_TTL_MS, launchMessage, type LaunchAction } from "./auth";

export const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export type Signed = { ok: true; owner: string; body: unknown } | { ok: false; res: Response };

export async function readSigned(req: Request, action: LaunchAction, agent: string, maxBytes = 16 * 1024): Promise<Signed> {
  const owner = normalizeAddress(req.headers.get(LAUNCH_HEADERS.owner));
  const signedAt = Number(req.headers.get(LAUNCH_HEADERS.signedAt));
  const signature = req.headers.get(LAUNCH_HEADERS.signature) ?? "";
  if (!owner) return { ok: false, res: fail(401, "Connect your wallet first.") };
  if (!isFreshLaunchSig(signedAt)) return { ok: false, res: fail(401, "The signature expired. Sign again.") };
  const raw = await readLimitedText(req, maxBytes);
  if (!raw.ok) return { ok: false, res: fail(raw.status, raw.status === 413 ? "Too large." : "Missing body.") };
  const bodySha256 = createHash("sha256").update(raw.value).digest("hex");
  if (!verifyAgentSignature({ address: owner, message: launchMessage({ action, owner, agent, bodySha256, signedAt }), signature })) {
    return { ok: false, res: fail(401, "The wallet signature does not match.") };
  }
  // Once per signature: a captured request cannot be replayed inside its freshness window.
  if (!(await allowRequest("launch-sig", signature, 1, 2 * LAUNCH_SIG_TTL_MS))) return { ok: false, res: fail(409, "That signature was already used. Sign again.") };
  let body: unknown;
  try {
    body = JSON.parse(raw.value);
  } catch {
    return { ok: false, res: fail(400, "Body must be JSON.") };
  }
  return { ok: true, owner, body };
}

export interface Cx {
  client: ConvexHttpClient;
  secret: string;
}

/** The backend with the launch secret; null when this deploy has neither. */
export function launchCx(): Cx | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const secret = internalSecret("launch");
  return url && secret.length >= 16 ? { client: new ConvexHttpClient(url), secret } : null;
}
