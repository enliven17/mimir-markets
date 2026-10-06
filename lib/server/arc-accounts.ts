/**
 * Solana wallet ↔ Arc account bindings (table `arc_accounts`, lib/server/db.ts).
 *
 * A Solana wallet maps to one Arc account and an Arc account to one wallet.
 * Rebinding a wallet to a new account needs a fresh pair of signatures (the
 * route checks them); an Arc account already bound to another wallet is
 * refused rather than moved.
 */
import { createPublicClient, http, type Hex } from "viem";

import { ARC, type ArcConfig } from "@/lib/arc/config";
import { query } from "./db";

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

export async function getArcBinding(solana: string): Promise<ArcBindingRow | null> {
  const rows = await query<{ solana: string; arc: string; bound_at: string | null }>(
    "SELECT solana, arc, bound_at FROM arc_accounts WHERE solana = $1",
    [solana],
  );
  const r = rows[0];
  return r ? { solana: r.solana, arc: r.arc as `0x${string}`, boundAt: Number(r.bound_at ?? 0) } : null;
}

export async function upsertArcBinding(args: {
  solana: string;
  arc: `0x${string}`;
  credentialId: string | null;
  now?: number;
}): Promise<ArcBindingRow> {
  const boundAt = args.now ?? Date.now();
  try {
    await query(
      `INSERT INTO arc_accounts (solana, arc, credential_id, bound_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (solana) DO UPDATE SET arc = excluded.arc, credential_id = excluded.credential_id, bound_at = excluded.bound_at`,
      [args.solana, args.arc, args.credentialId, boundAt],
    );
  } catch (err) {
    // 23505 unique_violation: only `arc` can collide here (solana is the conflict target).
    if ((err as { code?: string })?.code === "23505") throw new ArcAccountTakenError();
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
