/**
 * Phantom's deeplink protocol (docs.phantom.com/phantom-deeplinks), which Solflare implements at its own host.
 *
 * The page keeps an x25519 keypair, sends its public key with `connect`, and derives a shared secret with the
 * wallet's key from the answer (nacl.box.before). Every later request and answer is a nacl box under that secret
 * with a fresh 24-byte nonce; keys, nonces and payloads travel base58. The wallet answers by opening
 * `redirect_link` with `nonce` and `data` (or `errorCode` / `errorMessage`) in the query.
 *
 * Pure functions only (no window, no storage), so the round trip is testable against a simulated wallet.
 */
import bs58 from "bs58";
import nacl from "tweetnacl";

export type DeeplinkWallet = "phantom" | "solflare";
export type DeeplinkCluster = "mainnet-beta" | "testnet" | "devnet";
export type DeeplinkMethod = "signMessage" | "signTransaction" | "signAllTransactions" | "disconnect";

// ponytail: phantom.app/ul is the host Phantom's own demo app and older installs verify as an App Link; the docs
// now print phantom.com/ul, which serves the same paths. Switch if phantom.app/ul ever stops opening the app.
export const DEEPLINK_BASE: Record<DeeplinkWallet, string> = {
  phantom: "https://phantom.app/ul/v1",
  solflare: "https://solflare.com/ul/v1",
};

/** The query field that carries the wallet's encryption key on a connect answer. */
export const walletKeyParam = (wallet: DeeplinkWallet) => `${wallet}_encryption_public_key` as const;

export function sharedSecret(walletPublicKeyB58: string, dappSecretKey: Uint8Array): Uint8Array {
  return nacl.box.before(bs58.decode(walletPublicKeyB58), dappSecretKey);
}

export function encryptPayload(payload: unknown, shared: Uint8Array): { nonce: string; payload: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, shared);
  return { nonce: bs58.encode(nonce), payload: bs58.encode(box) };
}

/** Opens a wallet answer's `data` with its `nonce`; throws when it does not authenticate under the secret. */
export function decryptPayload<T>(dataB58: string, nonceB58: string, shared: Uint8Array): T {
  const opened = nacl.box.open.after(bs58.decode(dataB58), bs58.decode(nonceB58), shared);
  if (!opened) throw new Error("The wallet's answer could not be decrypted");
  return JSON.parse(new TextDecoder().decode(opened)) as T;
}

export function connectUrl(wallet: DeeplinkWallet, opts: { dappPublicKey: Uint8Array; redirect: string; appUrl: string; cluster: DeeplinkCluster }): string {
  const q = new URLSearchParams({
    app_url: opts.appUrl,
    dapp_encryption_public_key: bs58.encode(opts.dappPublicKey),
    redirect_link: opts.redirect,
    cluster: opts.cluster,
  });
  return `${DEEPLINK_BASE[wallet]}/connect?${q}`;
}

export function methodUrl(
  wallet: DeeplinkWallet,
  method: DeeplinkMethod,
  opts: { dappPublicKey: string; redirect: string; payload: unknown; shared: Uint8Array },
): string {
  const { nonce, payload } = encryptPayload(opts.payload, opts.shared);
  const q = new URLSearchParams({ dapp_encryption_public_key: opts.dappPublicKey, nonce, redirect_link: opts.redirect, payload });
  return `${DEEPLINK_BASE[wallet]}/${method}?${q}`;
}

/** A wallet's error answer, or null. 4001 is the user saying no. */
export function walletError(params: Record<string, string | undefined>): { code: number; message: string } | null {
  if (!params.errorCode) return null;
  const code = Number(params.errorCode);
  const message = code === 4001 ? "User rejected the request." : params.errorMessage || `The wallet returned error ${params.errorCode}`;
  return { code, message };
}

/** A random 128-bit request id, base64url (22 chars): what the relay files the wallet's answer under. */
export function newOp(): string {
  const b = nacl.randomBytes(16);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
