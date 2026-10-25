import { LAUNCH_HEADERS, isFreshLaunchSig } from "../launch/auth";
import { normalizeAddress, verifyAgentSignature } from "../agents/signature";

export const PREVIEW_OWNER_HEADER = "x-mimir-preview-owner";
export function previewWalletMessage(owner: string, signedAt: number): string {
  return ["Mimir Preview", `owner: ${owner}`, `signedAt: ${signedAt}`,
    "Sign in to your limited preview with virtual funds. No transaction or deposit.",
    "Only sign this on mimirmarkets.xyz."].join("\n");
}
export function verifiedPreviewOwner(request: Request): string | null {
  const owner = normalizeAddress(request.headers.get(PREVIEW_OWNER_HEADER));
  const signedAt = Number(request.headers.get(LAUNCH_HEADERS.signedAt));
  if (!owner || !isFreshLaunchSig(signedAt)) return null;
  return verifyAgentSignature({ address: owner, message: previewWalletMessage(owner, signedAt),
    signature: request.headers.get(LAUNCH_HEADERS.signature) ?? "" }) ? owner : null;
}
