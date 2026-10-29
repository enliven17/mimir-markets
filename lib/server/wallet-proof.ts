/**
 * Server side of the wallet proof (lib/wallet-proof.ts): the wallet a request
 * proves it controls, Solana (or Robinhood Chain) or Arc.
 */
import { normalizeOwner, verifyOwnerSignature } from "@/lib/owner";
import { WALLET_PROOF_HEADER, WALLET_HEADER, walletProofMessage, parseProofHeader } from "@/lib/wallet-proof";
import { verifyMessage, type Address } from "viem";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { EVM_PROOF_HEADER, EVM_WALLET_HEADER, evmProofMessage, normalizeEvmAddress, parseEvmProofHeader } from "@/lib/arc/evm";

/** The wallet a request proves it controls (the signed wallet proof headers), or null. */
export async function provenWallet(req: Request): Promise<string | null> {
  const wallet = normalizeOwner(req.headers.get(WALLET_HEADER));
  const proof = parseProofHeader(req.headers.get(WALLET_PROOF_HEADER));
  if (!wallet || !proof) return null;
  const ok = await verifyOwnerSignature({ address: wallet, message: walletProofMessage(wallet, proof.signedAt), signature: proof.signature });
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
