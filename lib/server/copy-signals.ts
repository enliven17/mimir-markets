import "server-only";

/**
 * Copy instructions for one execution agent, from the read index.
 *
 * Signal agents resolve to staking wallets exactly as basket members do
 * (persona roster, then the registry's operator wallet), and their live
 * positions come from the same index query mirror signals use. The
 * gate itself is pure (lib/copy-signals.ts, lib/copy-trading.ts).
 */
import { claimsChallengedBy, resolveAgentWallets } from "@/lib/baskets-performance";
import { candidateSignals, claimsHeldBy, planCopies, type CopyInstruction } from "@/lib/copy-signals";
import type { CopyPermission } from "@/lib/copy-trading";
import { loadUsage } from "@/lib/copy-trading-store";
import { onArc } from "@/lib/baskets-performance";
import { arcClaimStates } from "@/lib/server/arc-baskets";
import { isPaused } from "@/lib/ops/flags";
import { ST_ACTIVE, ST_OPEN } from "@/lib/solana/config";

/**
 * Everything `executorWallet` (the execution agent's operator) is currently
 * permitted to copy under `permissions`, allowed and skipped alike.
 */
export async function buildCopyInstructions(
  permissions: CopyPermission[],
  executorWallet: string,
  now = Date.now(),
): Promise<CopyInstruction[]> {
  if (permissions.length === 0) return [];
  const globallyPaused = isPaused("copy_execution");
  const wallets = await resolveAgentWallets([...new Set(permissions.map((p) => p.signalAgentId))]);
  const instructions: CopyInstruction[] = [];

  for (const permission of permissions) {
    const signalWallet = wallets.get(permission.signalAgentId);
    if (!signalWallet) continue;

    const [claims, usage] = await Promise.all([
      claimsChallengedBy([signalWallet], [ST_OPEN, ST_ACTIVE], 100).catch(() => []),
      // Without the ledger there is no way to know what was spent: refuse to
      // size anything rather than assume nothing was.
      loadUsage(permission.id, now, onArc() ? arcClaimStates : undefined).catch(() => null),
    ]);
    if (!usage) continue;

    const candidates = candidateSignals({ claims, signalWallet, signalAgentId: permission.signalAgentId, now });
    const held = [...new Set([...usage.heldClaimIds, ...claimsHeldBy(claims, executorWallet)])];
    instructions.push(
      ...planCopies({ permission, candidates, usage: { ...usage, heldClaimIds: held }, now, globallyPaused }),
    );
  }
  return instructions;
}
