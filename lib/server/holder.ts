/**
 * Server side of token utility: a wallet's mainnet balances and tier, and the
 * tier a request has proven with a signed holder proof (lib/token-proof.ts).
 */
import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { ansemMint, mimirMint } from "@/lib/token-config";
import { HOLDER_PROOF_HEADER, HOLDER_WALLET_HEADER, holderProofMessage, parseProofHeader } from "@/lib/token-proof";
import { tierFor, tierThresholdsFromEnv, type TokenBalances, type TokenTier } from "@/lib/token-tiers";
import { mainnetTokenBalance } from "./mainnet";
import { allowRequest, clientIp } from "./rate-limit";

/** Proofs one IP may have checked against mainnet per minute (audit P2-8). */
function proofChecksPerMinute(): number {
  const n = Number(process.env.HOLDER_PROOF_PER_MIN?.trim() || "20");
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** MIMIR is 0 before launch. Throws when mainnet cannot be read. */
/** Wallets whose balances were read within the balance cache TTL (bounded). */
const recentReads = new Map<string, number>();
const RECENT_READ_MS = 60_000;
function recentlyRead(wallet: string): boolean {
  return (recentReads.get(wallet) ?? 0) > Date.now();
}
function markRead(wallet: string): void {
  recentReads.delete(wallet);
  recentReads.set(wallet, Date.now() + RECENT_READ_MS);
  while (recentReads.size > 5_000) {
    const oldest = recentReads.keys().next().value;
    if (oldest === undefined) break;
    recentReads.delete(oldest);
  }
}

export async function walletBalances(wallet: string): Promise<TokenBalances> {
  const mint = mimirMint();
  const [mimir, ansem] = await Promise.all([
    mint ? mainnetTokenBalance(wallet, mint) : Promise.resolve(0),
    mainnetTokenBalance(wallet, ansemMint()),
  ]);
  return { mimir, ansem };
}

export async function walletTier(wallet: string): Promise<{ tier: TokenTier; balances: TokenBalances }> {
  const balances = await walletBalances(wallet);
  return { tier: tierFor(balances, tierThresholdsFromEnv()), balances };
}

/**
 * The tier a request proves via x-mimir-wallet + x-mimir-proof, or "none".
 * Never throws: a bad proof or an unreachable RPC just means no perk.
 */
/** The wallet a request proves it controls (the signed holder proof headers), or null. Reads no balance. */
export function provenWallet(req: Request): string | null {
  const wallet = normalizeAddress(req.headers.get(HOLDER_WALLET_HEADER));
  const proof = parseProofHeader(req.headers.get(HOLDER_PROOF_HEADER));
  if (!wallet || !proof) return null;
  const ok = verifyAgentSignature({ address: wallet, message: holderProofMessage(wallet, proof.signedAt), signature: proof.signature });
  return ok ? wallet : null;
}

export async function provenTier(req: Request): Promise<TokenTier> {
  const wallet = provenWallet(req);
  if (!wallet) return "none";
  // Every new wallet costs mainnet RPC reads: cap them per IP before the
  // first call, so fresh wallets cannot burn the RPC credit. A wallet read in
  // the last minute is served from the balance cache and is not counted.
  // Over the cap the caller just counts as a non-holder.
  if (!recentlyRead(wallet) && !(await allowRequest("holder-proof", clientIp(req), proofChecksPerMinute(), 60_000))) {
    return "none";
  }
  try {
    const { tier } = await walletTier(wallet);
    markRead(wallet);
    return tier;
  } catch {
    return "none";
  }
}

/**
 * Who a rate limit counts: a proven holder by wallet (at its tier), anyone
 * else by IP. `pool` names the deploy-wide ceiling the caller draws from, so
 * holder traffic has its own and is not starved by anonymous traffic.
 */
export async function rateIdentity(req: Request): Promise<{ key: string; tier: TokenTier; pool: string }> {
  const tier = await provenTier(req);
  if (tier === "none") return { key: clientIp(req), tier, pool: "all" };
  return { key: `wallet:${normalizeAddress(req.headers.get(HOLDER_WALLET_HEADER))}`, tier, pool: "holders" };
}
