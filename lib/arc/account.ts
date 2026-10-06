/**
 * The user's Arc account: a Circle Modular Wallet (ERC-4337 smart account)
 * owned by a passkey on their device (ported from scripts/arc-poc/page.html).
 * Every operation is sponsored (`paymaster: true`): Circle Gas Station pays
 * the gas, the user never holds gas money. Browser only (WebAuthn); load it
 * through lib/arc/lazy.ts.
 *
 * Persistence: only the passkey's PUBLIC credential (id + public key) and the
 * account address go to localStorage. Neither is a secret: the private key
 * never leaves the device's authenticator, and every signature still needs
 * the user's Face ID / fingerprint / PIN. When the entry is missing (a new
 * browser, cleared storage) the user logs in with the passkey again.
 */
import {
  getAddressMapping,
  OwnerIdentifierType,
  recoveryActions,
  toCircleModularWalletClient,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  WebAuthnMode,
  type WebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import { bytesToHex, createPublicClient, getAddress, hexToBigInt, hexToBytes, type Address, type Hex } from "viem";
import { createBundlerClient, toWebAuthnAccount, type SmartAccount } from "viem/account-abstraction";
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";

import type { ArcCall } from "./cctp-arc";
import { arcChain } from "./chain";
import { ARC, type ArcConfig } from "./config";

export interface StoredPasskey {
  id: string;
  publicKey: Hex;
  rpId?: string;
  /** The smart account it owns. Set after recovery, when the passkey is not the account's original owner. */
  address?: Address;
}

export interface CallsReceipt {
  userOpHash: Hex;
  txHash: Hex;
}

export interface ArcSession {
  address: Address;
  passkey: StoredPasskey;
  /** One sponsored user operation with every call; resolves once mined, throws if it reverted. */
  sendCalls(calls: ArcCall[]): Promise<CallsReceipt>;
  /** Sign a message with the passkey (ERC-1271, ERC-6492-wrapped while the account is not deployed). */
  signMessage(message: string): Promise<Hex>;
  /** Add a recovery key as a second owner (sponsored). */
  registerRecoveryAddress(recoveryAddress: Address): Promise<CallsReceipt>;
}

function requireClientKey(config: ArcConfig): string {
  if (!config.circle.clientKey) throw new Error("Arc accounts are not configured on this site (NEXT_PUBLIC_CIRCLE_CLIENT_KEY).");
  return config.circle.clientKey;
}

const storageKey = (config: ArcConfig) => `mimir:arc:passkey:${config.network}`;

export function loadStoredPasskey(config: ArcConfig = ARC): StoredPasskey | null {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(config)) ?? "null") as StoredPasskey | null;
    return v && typeof v.id === "string" && typeof v.publicKey === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveStoredPasskey(passkey: StoredPasskey, config: ArcConfig = ARC): void {
  localStorage.setItem(storageKey(config), JSON.stringify(passkey));
}

export function clearStoredPasskey(config: ArcConfig = ARC): void {
  localStorage.removeItem(storageKey(config));
}

function toStored(credential: WebAuthnCredential, address?: Address): StoredPasskey {
  return { id: credential.id, publicKey: credential.publicKey, rpId: credential.rpId, ...(address ? { address } : {}) };
}

/** x and y of a serialized P-256 public key (64 bytes, or 65 with the 0x04 prefix), as webauthn-p256 parses it. */
function p256Coordinates(publicKey: Hex): { x: bigint; y: bigint } {
  const bytes = hexToBytes(publicKey);
  const offset = bytes.length === 65 ? 1 : 0;
  return {
    x: hexToBigInt(bytesToHex(bytes.slice(offset, offset + 32))),
    y: hexToBigInt(bytesToHex(bytes.slice(offset + 32, offset + 64))),
  };
}

/**
 * The account a passkey owns. A recovered passkey is mapped to the original
 * account (executeRecovery writes that mapping), so ask Circle first; a fresh
 * passkey has no mapping and gets its own counterfactual account.
 */
async function resolveAccountAddress(passkey: StoredPasskey, config: ArcConfig): Promise<Address | undefined> {
  if (passkey.address) return passkey.address;
  try {
    const transport = toModularTransport(config.circle.modularUrl, requireClientKey(config));
    const client = toCircleModularWalletClient({ client: createPublicClient({ chain: arcChain(config), transport }) });
    const { x, y } = p256Coordinates(passkey.publicKey);
    const mapping = await getAddressMapping(client, {
      owner: { type: OwnerIdentifierType.WebAuthn, identifier: { publicKeyX: x.toString(), publicKeyY: y.toString() } },
    });
    return mapping[0]?.walletAddress;
  } catch {
    return undefined;
  }
}

async function sessionFor(account: SmartAccount, passkey: StoredPasskey, config: ArcConfig): Promise<ArcSession> {
  const transport = toModularTransport(config.circle.modularUrl, requireClientKey(config));
  const bundler = createBundlerClient({ account, chain: arcChain(config), transport });
  const wait = async (userOpHash: Hex): Promise<CallsReceipt> => {
    const { receipt, success, reason } = await bundler.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000 });
    if (!success || receipt.status !== "success") {
      throw new Error(`The Arc operation reverted${reason ? `: ${reason}` : ""} (tx ${receipt.transactionHash}).`);
    }
    return { userOpHash, txHash: receipt.transactionHash };
  };
  // Circle returns the address lowercased; checksum it so signed messages match the server's normalized form.
  const address = getAddress(account.address);
  return {
    address,
    passkey: { ...passkey, address },
    async sendCalls(calls) {
      if (!calls.length) throw new Error("no calls to send");
      const hash = await bundler.sendUserOperation({
        calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? 0n })),
        paymaster: true,
      });
      return wait(hash);
    },
    signMessage: (message) => account.signMessage({ message }),
    async registerRecoveryAddress(recoveryAddress) {
      const hash = await bundler.extend(recoveryActions).registerRecoveryAddress({ account, recoveryAddress, paymaster: true });
      return wait(hash);
    },
  };
}

/** Rebuild the session from a stored public credential. No prompt until something is signed. */
export async function openSession(passkey: StoredPasskey, config: ArcConfig = ARC): Promise<ArcSession> {
  const transport = toModularTransport(config.circle.modularUrl, requireClientKey(config));
  const client = createPublicClient({ chain: arcChain(config), transport });
  const owner = toWebAuthnAccount({ credential: { id: passkey.id, publicKey: passkey.publicKey }, rpId: passkey.rpId });
  const address = await resolveAccountAddress(passkey, config);
  const account = await toCircleSmartAccount({ client, owner, ...(address ? { address } : {}) });
  const session = await sessionFor(account, passkey, config);
  saveStoredPasskey(session.passkey, config);
  return session;
}

/** Create a new passkey on this device (the browser's Face ID / fingerprint / PIN prompt) and its account. */
export async function createPasskeyAccount(username: string, config: ArcConfig = ARC): Promise<ArcSession> {
  const credential = await toWebAuthnCredential({
    transport: toPasskeyTransport(config.circle.passkeyUrl, requireClientKey(config)),
    mode: WebAuthnMode.Register,
    username,
  });
  return openSession(toStored(credential), config);
}

/** Use a passkey this device (or a synced keychain) already has. */
export async function loginPasskeyAccount(config: ArcConfig = ARC): Promise<ArcSession> {
  const credential = await toWebAuthnCredential({
    transport: toPasskeyTransport(config.circle.passkeyUrl, requireClientKey(config)),
    mode: WebAuthnMode.Login,
  });
  return openSession(toStored(credential), config);
}

/** A fresh 12-word recovery phrase and the address of the key it derives. Never stored or sent anywhere. */
export function generateRecoveryPhrase(): { mnemonic: string; address: Address } {
  const mnemonic = generateMnemonic(english);
  return { mnemonic, address: mnemonicToAccount(mnemonic).address };
}

export function isValidRecoveryPhrase(mnemonic: string): boolean {
  try {
    mnemonicToAccount(normalizePhrase(mnemonic));
    return normalizePhrase(mnemonic).split(" ").length === 12;
  } catch {
    return false;
  }
}

const normalizePhrase = (m: string) => m.trim().toLowerCase().split(/\s+/).join(" ");

/**
 * Recover with the phrase: find the account the recovery key was registered
 * on, create a new passkey, and add it as an owner (signed by the recovery
 * key, sponsored). Returns a session on the original account.
 */
export async function recoverWithPhrase(mnemonic: string, username: string, config: ArcConfig = ARC): Promise<ArcSession> {
  const key = requireClientKey(config);
  const recoveryKey = mnemonicToAccount(normalizePhrase(mnemonic));
  const transport = toModularTransport(config.circle.modularUrl, key);
  const client = createPublicClient({ chain: arcChain(config), transport });
  const mapping = await getAddressMapping(toCircleModularWalletClient({ client }), {
    owner: { type: OwnerIdentifierType.EOA, identifier: { address: recoveryKey.address } },
  });
  const address = mapping[0]?.walletAddress;
  if (!address) throw new Error("No Arc account uses this recovery phrase.");
  const recoveryAccount = await toCircleSmartAccount({ client, owner: recoveryKey, address });
  const credential = await toWebAuthnCredential({
    transport: toPasskeyTransport(config.circle.passkeyUrl, key),
    mode: WebAuthnMode.Register,
    username,
  });
  const bundler = createBundlerClient({ account: recoveryAccount, chain: arcChain(config), transport }).extend(recoveryActions);
  const hash = await bundler.executeRecovery({ account: recoveryAccount, credential, paymaster: true });
  const { success, receipt } = await bundler.waitForUserOperationReceipt({ hash, timeout: 120_000 });
  if (!success || receipt.status !== "success") throw new Error(`Recovery reverted (tx ${receipt.transactionHash}).`);
  return openSession(toStored(credential, address), config);
}
