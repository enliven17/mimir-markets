/**
 * Server side of token utility: a wallet's mainnet balances and tier, and the
 * tier a request has proven with a signed holder proof (lib/token-proof.ts).
 */
import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { ansemMint, mimirMint } from "@/lib/token-config";
import { HOLDER_PROOF_HEADER, HOLDER_WALLET_HEADER, holderProofMessage, parseProofHeader } from "@/lib/token-proof";
import { tierFor, tierThresholdsFromEnv, type TokenBalances, type TokenTier } from "@/lib/token-tiers";
import { mainnetTokenBalance } from "./mainnet";
import { clientIp } from "./rate-limit";

/** MIMIR is 0 before launch. Throws when mainnet cannot be read. */
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
export async function provenTier(req: Request): Promise<TokenTier> {
  const wallet = normalizeAddress(req.headers.get(HOLDER_WALLET_HEADER));
  const proof = parseProofHeader(req.headers.get(HOLDER_PROOF_HEADER));
  if (!wallet || !proof) return "none";
  const ok = verifyAgentSignature({
    address: wallet,
    message: holderProofMessage(wallet, proof.signedAt),
    signature: proof.signature,
  });
  if (!ok) return "none";
  try {
    return (await walletTier(wallet)).tier;
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
