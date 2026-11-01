import { LAUNCH_HEADERS, isFreshLaunchSig } from "../launch/auth";
import { normalizeOwner, verifyOwnerSignature } from "../owner";

export const PREVIEW_OWNER_HEADER = "x-mimir-preview-owner";
export function previewWalletMessage(owner: string, signedAt: number): string {
  return ["Mimir Preview", `owner: ${owner}`, `signedAt: ${signedAt}`,
    "Sign in to your limited preview with virtual funds. No transaction or deposit.",
    "Only sign this on mimirmarkets.xyz."].join("\n");
}
export async function verifiedPreviewOwner(request: Request): Promise<string | null> {
  const owner = normalizeOwner(request.headers.get(PREVIEW_OWNER_HEADER));
  const signedAt = Number(request.headers.get(LAUNCH_HEADERS.signedAt));
  if (!owner || !isFreshLaunchSig(signedAt)) return null;
  return (await verifyOwnerSignature({ address: owner, message: previewWalletMessage(owner, signedAt),
    signature: request.headers.get(LAUNCH_HEADERS.signature) ?? "" })) ? owner : null;
}
