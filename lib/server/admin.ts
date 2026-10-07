/**
 * Who may open the admin panel: Solana wallets in ADMIN_WALLETS (comma list), proven with the signed holder-proof
 * headers (lib/token-proof.ts). Anyone else gets the same 404 an unknown route gives, so the panel does not reveal
 * that it exists.
 */
import { provenWallet } from "./holder";

const DEFAULT_ADMIN = "5JZp9pA33eoUREpQS6ui6AFVdaQ147aBrjh79w252gRQ";

export function adminWallets(env: Record<string, string | undefined> = process.env): Set<string> {
  const list = (env.ADMIN_WALLETS ?? DEFAULT_ADMIN).split(/[,\s]+/).filter(Boolean);
  return new Set(list);
}

/** The proven admin wallet behind a request, or null. */
export function adminWallet(req: Request, env: Record<string, string | undefined> = process.env): string | null {
  const wallet = provenWallet(req);
  return wallet && adminWallets(env).has(wallet) ? wallet : null;
}
