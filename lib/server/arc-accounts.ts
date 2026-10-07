/**
 * Solana wallet ↔ Arc account bindings (backend table `arc_accounts`, lib/server/store.ts): one row per wallet,
 * plus an `arc_owners` row per Arc account so an account can only ever belong to one wallet.
 *
 * A Solana wallet maps to one Arc account and an Arc account to one wallet.
 * Rebinding a wallet to a new account needs a fresh pair of signatures (the
 * route checks them); an Arc account already bound to another wallet is
 * refused rather than moved.
 */
import { createPublicClient, http, type Hex } from "viem";

import { ARC, type ArcConfig } from "@/lib/arc/config";
import { store, StoreConflict, type Step } from "./store";

export interface ArcBindingRow {
  solana: string;
  arc: `0x${string}`;
  boundAt: number;
}

export class ArcAccountTakenError extends Error {
  constructor() {
    super("this Arc account is already bound to another Solana wallet");
  }
}

type Row = { solana: string; arc: string; credential_id: string | null; bound_at: number | null };
const toBinding = (r: Row | null): ArcBindingRow | null =>
  r ? { solana: r.solana, arc: r.arc as `0x${string}`, boundAt: Number(r.bound_at ?? 0) } : null;

export async function getArcBinding(solana: string): Promise<ArcBindingRow | null> {
  return toBinding(await store().get<Row>("arc_accounts", solana));
}

/** The Solana wallet an Arc account is bound to. `arc` must be checksummed (getAddress), as it is stored. */
export async function getArcBindingByArc(arc: string): Promise<ArcBindingRow | null> {
  const owner = await store().get<{ solana: string }>("arc_owners", arc);
  if (!owner) return null;
  const b = toBinding(await store().get<Row>("arc_accounts", owner.solana));
  return b && b.arc === arc ? b : null;
}

export async function upsertArcBinding(args: {
  solana: string;
  arc: `0x${string}`;
  credentialId: string | null;
  now?: number;
}): Promise<ArcBindingRow> {
  const boundAt = args.now ?? Date.now();
  const s = store();
  const previous = await s.get<Row>("arc_accounts", args.solana);
  const steps: Step[] = [];
  // The account must be free, or already this wallet's; a wallet moving to a new account frees its old one.
  if (previous && previous.arc !== args.arc) steps.push({ op: "remove", t: "arc_owners", k: previous.arc });
  steps.push(
    { op: "insert", t: "arc_owners", k: args.arc, d: { arc: args.arc, solana: args.solana }, at: boundAt },
    { op: "update", t: "arc_owners", k: args.arc, d: {}, when: { solana: args.solana }, must: true },
    { op: "put", t: "arc_accounts", k: args.solana, d: { solana: args.solana, arc: args.arc, credential_id: args.credentialId, bound_at: boundAt }, i1: args.arc, at: boundAt },
  );
  try {
    await s.tx(steps);
  } catch (err) {
    if (err instanceof StoreConflict) throw new ArcAccountTakenError();
    throw err;
  }
  return { solana: args.solana, arc: args.arc, boundAt };
}

/**
 * The passkey account signed `message`: ERC-1271 on a deployed account,
 * ERC-6492 (viem's universal validator, one eth_call) on a counterfactual one.
 * Null when the check itself could not run (Arc RPC down), so the route can
 * answer 503 instead of blaming the signature.
 */
export async function verifyArcSignature(
  address: `0x${string}`,
  message: string,
  signature: Hex,
  config: ArcConfig = ARC,
): Promise<boolean | null> {
  const client = createPublicClient({ transport: http(process.env.ARC_RPC?.trim() || config.chain.rpcUrl, { timeout: 10_000 }) });
  try {
    return await client.verifyMessage({ address, message, signature });
  } catch (err) {
    console.warn("[arc-bind] signature check could not run:", err);
    return null;
  }
}
