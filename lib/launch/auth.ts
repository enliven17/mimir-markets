/**
 * Mimir Launch: every owner request is signed by the owner's Solana wallet (wallet-adapter `signMessage`).
 * The message names the action, the agent and the SHA-256 of the exact body sent, so a signature cannot be
 * moved to another body, agent or action. Fresh for 5 minutes. Isomorphic: the browser builds the same text.
 */
export const LAUNCH_SIG_TTL_MS = 5 * 60_000;
export type LaunchAction = "create" | "launch" | "status" | "withdraw" | "brain";

export function launchMessage(a: { action: LaunchAction; owner: string; agent: string; bodySha256: string; signedAt: number }): string {
  return [
    "Mimir Launch",
    `action: ${a.action}`,
    `owner: ${a.owner}`,
    `agent: ${a.agent}`,
    `body: ${a.bodySha256}`,
    `signedAt: ${a.signedAt}`,
    "Only sign this on mimirmarkets.xyz.",
  ].join("\n");
}

export const isFreshLaunchSig = (signedAt: number, now = Date.now()) =>
  Number.isSafeInteger(signedAt) && signedAt <= now + LAUNCH_SIG_TTL_MS && now - signedAt <= LAUNCH_SIG_TTL_MS;

/** Headers the browser sends with the raw JSON body. */
export const LAUNCH_HEADERS = { owner: "x-mimir-owner", signedAt: "x-mimir-signed-at", signature: "x-mimir-signature" } as const;
