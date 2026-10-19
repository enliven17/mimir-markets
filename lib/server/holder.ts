/**
 * Server side of token utility: a wallet's mainnet balances and tier, and the
 * tier a request has proven with a signed holder proof (lib/token-proof.ts).
 */
import { isEvmOwner, normalizeOwner, verifyOwnerSignature } from "@/lib/owner";
import { ansemMint, mimirMint } from "@/lib/token-config";
import { HOLDER_PROOF_HEADER, HOLDER_WALLET_HEADER, holderProofMessage, parseProofHeader } from "@/lib/token-proof";
import { tierFor, tierThresholdsFromEnv, type TokenBalances, type TokenTier } from "@/lib/token-tiers";
import { mainnetTokenBalance } from "./mainnet";
import { verifyMessage, type Address } from "viem";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { EVM_PROOF_HEADER, EVM_WALLET_HEADER, evmProofMessage, normalizeEvmAddress, parseEvmProofHeader } from "@/lib/arc/evm";
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
  // The tokens are Solana mints: a Robinhood Chain wallet holds none of them.
  if (isEvmOwner(wallet)) return { mimir: 0, ansem: 0 };
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
export async function provenWallet(req: Request): Promise<string | null> {
  const wallet = normalizeOwner(req.headers.get(HOLDER_WALLET_HEADER));
  const proof = parseProofHeader(req.headers.get(HOLDER_PROOF_HEADER));
  if (!wallet || !proof) return null;
  const ok = await verifyOwnerSignature({ address: wallet, message: holderProofMessage(wallet, proof.signedAt), signature: proof.signature });
  return ok ? wallet : null;
}

/**
 * The Arc (EVM) wallet a request proves it controls (x-mimir-evm + x-mimir-evm-proof, lib/arc/evm.ts), checksummed,
 * or null. A plain wallet's signature is recovered locally; a smart wallet's (ERC-1271) is checked on Arc.
 */
export async function provenEvmWallet(req: Request): Promise<Address | null> {
  const wallet = normalizeEvmAddress(req.headers.get(EVM_WALLET_HEADER));
  const proof = parseEvmProofHeader(req.headers.get(EVM_PROOF_HEADER));
  if (!wallet || !proof) return null;
  const message = evmProofMessage(wallet, proof.signedAt);
  if (await verifyMessage({ address: wallet, message, signature: proof.signature }).catch(() => false)) return wallet;
  return (await arcPublicClient(ARC).verifyMessage({ address: wallet, message, signature: proof.signature }).catch(() => false)) ? wallet : null;
}

/** Who a request proves to be, for access and invite codes: the Solana wallet, else the Arc wallet. */
export async function provenIdentity(req: Request): Promise<string | null> {
  return (await provenWallet(req)) ?? (await provenEvmWallet(req));
}

export async function provenTier(req: Request): Promise<TokenTier> {
  const wallet = await provenWallet(req);
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
  return { key: `wallet:${normalizeOwner(req.headers.get(HOLDER_WALLET_HEADER))}`, tier, pool: "holders" };
}
