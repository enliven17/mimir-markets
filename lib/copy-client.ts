/**
 * Browser calls to `/api/copy/permissions`, plus the agent lists the grant
 * form picks from (`/api/baskets/candidates` for who can be copied,
 * `/api/agents/registry` for who can execute).
 *
 * Every response is folded into one `CopyApiResult` so the page can tell apart
 * the three things that matter to a user: it worked, the feature is off on
 * this deployment, or the server refused with a reason worth showing.
 */
import type { CopyPermission } from "./copy-trading";

export interface CopyExecutionView {
  claimId: number;
  executed: boolean;
  skipReason: string | null;
  stakeUsdc: number;
  txSignature: string | null;
  at: number;
}

/** What GET returns per permission: signature stripped, audit trail added. */
export type CopyPermissionView = Omit<CopyPermission, "signature"> & {
  worstCaseUsdc: number;
  recent: CopyExecutionView[];
};

export interface AgentOption {
  agentId: string;
  label: string;
  /** The wallet that stakes for this agent (persona key or operator wallet). */
  wallet: string;
  kind: "persona" | "agent";
}

export type CopyApiResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "disabled" }
  | { kind: "error"; status: number; reason: string; message: string };

const PERMISSIONS_URL = "/api/copy/permissions";

async function request<T>(url: string, init?: RequestInit): Promise<CopyApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    return { kind: "error", status: 0, reason: "network", message: "network error" };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 404 && body.reason === "feature_disabled") return { kind: "disabled" };
  if (!res.ok) {
    return {
      kind: "error",
      status: res.status,
      reason: String(body.reason ?? "http_error"),
      message: String(body.message ?? `HTTP ${res.status}`),
    };
  }
  return { kind: "ok", data: body as T };
}

/**
 * Whether the copy endpoints are on, without asking for a signature: the
 * route checks the flag first, so a bare GET answers 404 feature_disabled
 * when off and 400 bad_wallet when on.
 */
export async function probeCopyTrading(): Promise<"enabled" | "disabled" | "unknown"> {
  const result = await request<unknown>(PERMISSIONS_URL);
  if (result.kind === "disabled") return "disabled";
  if (result.kind === "error" && result.status === 0) return "unknown";
  return "enabled";
}

export function listCopyPermissions(follower: string, at: number, signature: string) {
  const q = new URLSearchParams({ follower, at: String(at), signature });
  return request<{ permissions?: CopyPermissionView[] }>(`${PERMISSIONS_URL}?${q}`);
}

export function revokeCopyPermission(id: string, follower: string, at: number, signature: string) {
  const q = new URLSearchParams({ id, follower, at: String(at), signature });
  return request<{ ok: true; revoked: string }>(`${PERMISSIONS_URL}?${q}`, { method: "DELETE" });
}

export function grantCopyPermission(body: Record<string, unknown>) {
  return request<{ ok: true; id: string; expiresAt: number; worstCaseUsdc: number }>(PERMISSIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Council personas with a derivable wallet, and active registered agents. */
export async function listSignalAgents(): Promise<AgentOption[]> {
  const result = await request<{ candidates?: AgentOption[] }>("/api/baskets/candidates");
  return result.kind === "ok" ? result.data.candidates ?? [] : [];
}

/** Active registered agents; the server checks the follower owns or operates the one picked. */
export async function listExecutionAgents(): Promise<AgentOption[]> {
  const result = await request<{
    agents?: Array<{ agentId: string; displayName: string; operatorWallet: string; status?: string }>;
  }>("/api/agents/registry");
  if (result.kind !== "ok") return [];
  return (result.data.agents ?? [])
    .filter((a) => a.status === "active")
    .map((a) => ({ agentId: a.agentId, label: a.displayName || a.agentId, wallet: a.operatorWallet, kind: "agent" }));
}
