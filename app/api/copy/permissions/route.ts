/**
 * Copy permissions: grant, list, revoke.
 *
 *   GET    /api/copy/permissions?follower=<base58>&at=<ms>&signature=<base58>
 *   POST   /api/copy/permissions                       grant (follower-signed)
 *   DELETE /api/copy/permissions?id=…&follower=…&at=…&signature=…   revoke, immediately
 *
 * Every call is signed by the follower (ed25519 over the UTF-8 message,
 * base58): the grant over `copyPermissionMessage` (with `signedAt`), list and
 * revoke over `followerProofMessage`. Timestamps must be within 5 minutes of
 * server time, so a stranger can neither list a wallet's limits nor cancel its
 * copies, and an old signature cannot be replayed later.
 *
 * The execution agent must be a registered, active agent the follower owns or
 * operates: copies are staked from that agent's operator balance, so this is
 * what keeps "the follower's money" literally true. Nothing is custodied.
 *
 * Behind `MIMIR_FEATURE_COPY_TRADING`; while it is off every method answers
 * 404 feature_disabled rather than accepting grants nothing will act on.
 */
import {
  copyPermissionMessage,
  followerProofMessage,
  isFreshCopySignature,
  InvalidCopyPermissionError,
  validateCopyPermission,
  worstCaseCopySpend,
  type CopyPermission,
} from "@/lib/copy-trading";
import { copyDraftError, copyDraftFromBody } from "@/lib/copy-form";
import {
  getPermission,
  listExecutions,
  listPermissions,
  revokePermission,
  savePermission,
} from "@/lib/copy-trading-store";
import { resolveAgentWallets } from "@/lib/baskets-performance";
import { getAgent } from "@/lib/agents/store";
import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { isFeatureEnabled } from "@/lib/ops/flags";
import { storeEnabled } from "@/lib/server/store";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { basketFail as fail, basketJson as json, readJsonBody } from "@/lib/server/basket-http";

export const dynamic = "force-dynamic";

function disabled(): Response {
  return fail(404, "feature_disabled", "copy trading is not enabled on this deployment");
}

function unavailable(): Response {
  return fail(503, "store_unavailable", "copy trading needs the backend on this deploy");
}

/** The follower signed this action within the skew window. Null when fine. */
function followerProofError(
  url: URL,
  action: "list" | "revoke",
  follower: string,
  id = "",
): { error: Response } | { at: number } {
  const at = Number(url.searchParams.get("at"));
  if (!isFreshCopySignature(at)) {
    return { error: fail(401, "stale_signature", "at must be a ms timestamp within 5 minutes of now") };
  }
  const ok = verifyAgentSignature({
    address: follower,
    message: followerProofMessage(action, follower, at, id),
    signature: url.searchParams.get("signature") ?? "",
  });
  return ok ? { at } : { error: fail(401, "bad_signature", "the follower signature does not match") };
}

function publicPermission(p: CopyPermission) {
  // The signature is the follower's own, but there is no reason to serve it back.
  const { signature: _signature, ...rest } = p;
  return { ...rest, worstCaseUsdc: worstCaseCopySpend(p) };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Feature probe for the page: 200 either way, so the check logs no browser error.
  if (url.searchParams.get("probe") === "1") {
    return json({ ok: true, enabled: isFeatureEnabled("copy_trading") });
  }
  if (!isFeatureEnabled("copy_trading")) return disabled();
  if (!(await allowRequest("copy-list", clientIp(req), 30, 60_000))) return tooManyRequests(60);

  const follower = normalizeAddress(url.searchParams.get("follower"));
  if (!follower) return fail(400, "bad_wallet", "follower must be a Solana public key");
  const proof = followerProofError(url, "list", follower);
  if ("error" in proof) return proof.error;
  if (!storeEnabled()) return json({ ok: true, permissions: [] });

  const permissions = await listPermissions(follower).catch(() => []);
  const withAudit = await Promise.all(
    permissions.map(async (p) => ({
      ...publicPermission(p),
      recent: await listExecutions(p.id, 10).catch(() => []),
    })),
  );
  return json({ ok: true, permissions: withAudit });
}

export async function POST(req: Request): Promise<Response> {
  if (!isFeatureEnabled("copy_trading")) return disabled();
  if (!(await allowRequest("copy-grant", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  if (!storeEnabled()) return unavailable();

  const body = await readJsonBody(req);
  if (!body) return fail(400, "malformed_json", "body is not a JSON object");

  const follower = normalizeAddress(body.follower);
  if (!follower) return fail(400, "bad_wallet", "follower must be a Solana public key");

  const draft = copyDraftFromBody(body, follower);
  if (!isFreshCopySignature(draft.signedAt)) {
    return fail(401, "stale_signature", "signedAt must be a ms timestamp within 5 minutes of now");
  }
  const draftError = copyDraftError(draft);
  if (draftError) {
    return fail(400, /^id must/.test(draftError) ? "bad_id" : "invalid_permission", draftError);
  }

  const permission: CopyPermission = {
    ...draft,
    signature: typeof body.signature === "string" ? body.signature : "",
    createdAt: Date.now(),
  };
  try {
    validateCopyPermission(permission);
  } catch (err) {
    if (err instanceof InvalidCopyPermissionError) return fail(400, "invalid_permission", err.message);
    throw err;
  }

  // Signed over the human-readable terms, so what was approved is exactly what
  // the wallet prompt showed. Checked before any lookup that reveals state.
  const signedOk = verifyAgentSignature({
    address: follower,
    message: copyPermissionMessage(draft),
    signature: permission.signature,
  });
  if (!signedOk) return fail(401, "bad_signature", "the follower signature does not match");

  const [executor, wallets, existing] = await Promise.all([
    getAgent(draft.executionAgentId).catch(() => null),
    resolveAgentWallets([draft.signalAgentId]).catch(() => new Map<string, string>()),
    getPermission(draft.id).catch(() => null),
  ]);
  if (!executor || executor.status !== "active") {
    return fail(400, "unknown_executor", "the execution agent must be a registered, active agent");
  }
  if (executor.ownerWallet !== follower && executor.operatorWallet !== follower) {
    return fail(
      403,
      "executor_not_yours",
      "the execution agent must be owned or operated by the follower: it stakes from its own balance",
    );
  }
  const signalWallet = wallets.get(draft.signalAgentId);
  if (!signalWallet) {
    return fail(400, "unknown_signal_agent", "the signal agent is neither a council persona nor a registered agent");
  }
  if (signalWallet === executor.operatorWallet) {
    return fail(400, "invalid_permission", "the signal and execution agents stake from the same wallet");
  }
  if (existing && existing.follower !== follower) {
    return fail(409, "permission_exists", "that permission id belongs to another wallet");
  }

  const stored = await savePermission(permission).catch(() => null);
  if (stored === null) return unavailable();
  if (!stored) {
    return fail(409, "signature_replay", "a newer grant or revocation for this id is already on file");
  }
  return json(
    {
      ok: true,
      id: draft.id,
      expiresAt: draft.expiresAt,
      worstCaseUsdc: worstCaseCopySpend(draft),
      custody: "none: copies are challenges your own agent signs and stakes from its own balance",
    },
    { status: 201 },
  );
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isFeatureEnabled("copy_trading")) return disabled();
  if (!(await allowRequest("copy-revoke", clientIp(req), 20, 60_000))) return tooManyRequests(60);
  if (!storeEnabled()) return unavailable();

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") ?? "").trim();
  const follower = normalizeAddress(url.searchParams.get("follower"));
  if (!id || !follower) return fail(400, "bad_request", "id and follower are required");

  // A signature but no gas and no nonce: stopping stays one wallet prompt away.
  const proof = followerProofError(url, "revoke", follower, id);
  if ("error" in proof) return proof.error;

  const revoked = await revokePermission(id, follower, proof.at).catch(() => null);
  if (revoked === null) return unavailable();
  if (revoked === 0) return fail(404, "not_found", "no active permission with that id");
  return json({ ok: true, revoked: id });
}
