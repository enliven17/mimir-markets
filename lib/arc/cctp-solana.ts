/**
 * The Solana side of CCTP V2 (ported from scripts/arc-poc/cctp-solana.mjs):
 * burn USDC to an Arc account, and mint an attested Arc burn into a Solana
 * USDC account. Signs through any `SolanaSigner`: the connected wallet-adapter
 * wallet in the browser, a Keypair in node scripts. Heavy (Anchor + the two
 * program IDLs): load it through lib/arc/lazy.ts.
 */
import { AnchorProvider, BN, Program, type AccountClient, type Idl } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, type Connection, type VersionedTransaction } from "@solana/web3.js";

import { ARC, FINALITY_FAST, type ArcConfig } from "./config";
import { evmAddressToBytes, hexToBytes } from "./encoding";
import messageTransmitterIdl from "./idl/message_transmitter_v2.json";
import tokenMessengerMinterIdl from "./idl/token_messenger_minter_v2.json";

export interface SolanaSigner {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
}

const seed = (s: string | Uint8Array) => (typeof s === "string" ? Buffer.from(s) : Buffer.from(s));
const pda = (seeds: Array<string | Uint8Array>, program: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds.map(seed), program)[0];

function programs(connection: Connection, signer: SolanaSigner, config: ArcConfig) {
  const wallet = {
    publicKey: signer.publicKey,
    signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => signer.signTransaction(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      const out: T[] = [];
      for (const tx of txs) out.push(await signer.signTransaction(tx));
      return out;
    },
  };
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const tmmIdl = { ...(tokenMessengerMinterIdl as Idl), address: config.solana.tokenMessengerMinter };
  const mtIdl = { ...(messageTransmitterIdl as Idl), address: config.solana.messageTransmitter };
  return {
    tmm: new Program(tmmIdl, provider),
    mt: new Program(mtIdl, provider),
    TMM: new PublicKey(config.solana.tokenMessengerMinter),
    MT: new PublicKey(config.solana.messageTransmitter),
    mint: new PublicKey(config.solana.usdcMint),
  };
}

export function solanaUsdcAta(owner: PublicKey, config: ArcConfig = ARC): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(config.solana.usdcMint), owner, true);
}

/** USDC in the owner's associated token account, in base units (0 when it does not exist). */
export async function solanaUsdcBalance(connection: Connection, owner: PublicKey, config: ArcConfig = ARC): Promise<bigint> {
  const ata = solanaUsdcAta(owner, config);
  const info = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return info ? BigInt(info.value.amount) : 0n;
}

async function signAndSend(
  connection: Connection,
  signer: SolanaSigner,
  tx: Transaction,
  extraSigners: Keypair[] = [],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = blockhash;
  // Extra signers first, the wallet last: wallet-adapter's own sendTransaction does the same.
  if (extraSigners.length) tx.partialSign(...extraSigners);
  const signed = await signer.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
  const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Solana transaction ${signature} failed: ${JSON.stringify(res.value.err)}`);
  return signature;
}

/**
 * Burn `amount` USDC (base units) from the signer's USDC account to `arcRecipient` on Arc, Fast Transfer.
 * Anyone may call receiveMessage on Arc (`destinationCaller` zero). Returns the Solana signature.
 */
export async function burnToArc(args: {
  connection: Connection;
  signer: SolanaSigner;
  amount: bigint;
  arcRecipient: string;
  maxFee: bigint;
  config?: ArcConfig;
}): Promise<string> {
  const { connection, signer, amount, arcRecipient, maxFee, config = ARC } = args;
  if (amount <= 0n) throw new Error("amount must be positive");
  if (maxFee >= amount) throw new Error("the transfer fee would take the whole amount");
  const { tmm, TMM, MT, mint } = programs(connection, signer, config);
  const event = Keypair.generate();
  const tx = await tmm.methods
    .depositForBurn({
      amount: new BN(amount.toString()),
      destinationDomain: config.cctp.domains.arc,
      mintRecipient: new PublicKey(evmAddressToBytes(arcRecipient)),
      destinationCaller: PublicKey.default,
      maxFee: new BN(maxFee.toString()),
      minFinalityThreshold: FINALITY_FAST,
    })
    .accounts({
      owner: signer.publicKey,
      eventRentPayer: signer.publicKey,
      burnTokenAccount: solanaUsdcAta(signer.publicKey, config),
      messageTransmitter: pda(["message_transmitter"], MT),
      tokenMessenger: pda(["token_messenger"], TMM),
      remoteTokenMessenger: pda(["remote_token_messenger", String(config.cctp.domains.arc)], TMM),
      tokenMinter: pda(["token_minter"], TMM),
      burnTokenMint: mint,
      messageSentEventData: event.publicKey,
    })
    .transaction();
  return signAndSend(connection, signer, tx, [event]);
}

/** Create the owner's USDC account when it is missing (its own transaction: receive_message is near the size limit). */
export async function ensureUsdcAta(args: {
  connection: Connection;
  signer: SolanaSigner;
  owner: PublicKey;
  config?: ArcConfig;
}): Promise<string | null> {
  const { connection, signer, owner, config = ARC } = args;
  const ata = solanaUsdcAta(owner, config);
  if (await connection.getAccountInfo(ata, "confirmed")) return null;
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, ata, owner, new PublicKey(config.solana.usdcMint)),
  );
  return signAndSend(connection, signer, tx);
}

/**
 * Mint an attested Arc burn on Solana: MessageTransmitterV2.receive_message
 * with the TokenMessengerMinterV2 accounts, in exactly the PoC's order.
 */
export async function receiveOnSolana(args: {
  connection: Connection;
  signer: SolanaSigner;
  message: `0x${string}`;
  attestation: `0x${string}`;
  recipientAta: PublicKey;
  config?: ArcConfig;
}): Promise<string> {
  const { connection, signer, message, attestation, recipientAta, config = ARC } = args;
  const { mt, tmm, TMM, MT, mint } = programs(connection, signer, config);
  const msg = Buffer.from(hexToBytes(message));
  const nonce = msg.subarray(12, 44);
  const remoteDomain = String(config.cctp.domains.arc);
  const remoteToken = new PublicKey(evmAddressToBytes(config.usdc));
  const tokenMessenger = pda(["token_messenger"], TMM);
  const { feeRecipient } = (await (tmm.account as unknown as Record<string, AccountClient>).tokenMessenger.fetch(tokenMessenger)) as { feeRecipient: PublicKey };
  const meta = (pubkey: PublicKey, isWritable = false) => ({ pubkey, isSigner: false, isWritable });
  const tx = await mt.methods
    .receiveMessage({ message: msg, attestation: Buffer.from(hexToBytes(attestation)) })
    .accounts({
      payer: signer.publicKey,
      caller: signer.publicKey,
      authorityPda: pda(["message_transmitter_authority", TMM.toBytes()], MT),
      messageTransmitter: pda(["message_transmitter"], MT),
      usedNonce: pda(["used_nonce", nonce], MT),
      receiver: TMM,
    })
    .remainingAccounts([
      meta(tokenMessenger),
      meta(pda(["remote_token_messenger", remoteDomain], TMM)),
      meta(pda(["token_minter"], TMM), true),
      meta(pda(["local_token", mint.toBytes()], TMM), true),
      meta(pda(["token_pair", remoteDomain, remoteToken.toBytes()], TMM)),
      meta(getAssociatedTokenAddressSync(mint, feeRecipient, true), true),
      meta(recipientAta, true),
      meta(pda(["custody", mint.toBytes()], TMM), true),
      meta(TOKEN_PROGRAM_ID),
      meta(pda(["__event_authority"], TMM)),
      meta(TMM),
    ])
    .transaction();
  return signAndSend(connection, signer, tx);
}
