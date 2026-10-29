/**
 * Arc (EVM) wallet ↔ passkey account bindings, for people who sign in natively on Arc (lib/arc/evm.ts): one row per
 * wallet in `arc_evm_accounts`, plus an `arc_evm_owners` row per account so an account belongs to one wallet. Same
 * rules as the Solana binding (lib/server/arc-accounts.ts): a taken account is refused, not moved, and a wallet may
 * switch accounts once a day. Kept apart from the Solana tables so an Arc-native user can also link a Solana wallet
 * later without either binding replacing the other.
 */
import type { Address } from "viem";

import { ArcRebindTooSoonError, REBIND_COOLDOWN_MS } from "./arc-accounts";
import { store, StoreConflict, type Step } from "./store";

export interface ArcEvmBindingRow {
  evm: Address;
  arc: Address;
  boundAt: number;
}

export class ArcEvmAccountTakenError extends Error {
  constructor() {
    super("This passkey account is already linked to another Arc wallet. Use a different passkey on this device and create a new account.");
  }
}

type Row = { evm: string; arc: string; credential_id: string | null; bound_at: number | null };
const toBinding = (r: Row | null): ArcEvmBindingRow | null => (r ? { evm: r.evm as Address, arc: r.arc as Address, boundAt: Number(r.bound_at ?? 0) } : null);

/** Both addresses checksummed (getAddress), as stored. */
export async function getArcEvmBinding(evm: string): Promise<ArcEvmBindingRow | null> {
  return toBinding(await store().get<Row>("arc_evm_accounts", evm));
}

export async function getArcEvmBindingByArc(arc: string): Promise<ArcEvmBindingRow | null> {
  const owner = await store().get<{ evm: string }>("arc_evm_owners", arc);
  if (!owner) return null;
  const b = toBinding(await store().get<Row>("arc_evm_accounts", owner.evm));
  return b && b.arc === arc ? b : null;
}

export async function upsertArcEvmBinding(args: { evm: Address; arc: Address; credentialId: string | null; now?: number }): Promise<ArcEvmBindingRow> {
  const boundAt = args.now ?? Date.now();
  const s = store();
  const previous = await s.get<Row>("arc_evm_accounts", args.evm);
  if (previous && previous.arc !== args.arc && previous.bound_at && boundAt - Number(previous.bound_at) < REBIND_COOLDOWN_MS) {
    throw new ArcRebindTooSoonError(Number(previous.bound_at) + REBIND_COOLDOWN_MS);
  }
  const steps: Step[] = [];
  if (previous && previous.arc !== args.arc) steps.push({ op: "remove", t: "arc_evm_owners", k: previous.arc });
  steps.push(
    // The account must be free, or already this wallet's.
    { op: "insert", t: "arc_evm_owners", k: args.arc, d: { arc: args.arc, evm: args.evm }, at: boundAt },
    { op: "update", t: "arc_evm_owners", k: args.arc, d: {}, when: { evm: args.evm }, must: true },
    { op: "put", t: "arc_evm_accounts", k: args.evm, d: { evm: args.evm, arc: args.arc, credential_id: args.credentialId, bound_at: boundAt }, i1: args.arc, at: boundAt },
  );
  try {
    await s.tx(steps);
  } catch (err) {
    if (err instanceof StoreConflict) throw new ArcEvmAccountTakenError();
    throw err;
  }
  return { evm: args.evm, arc: args.arc, boundAt };
}
