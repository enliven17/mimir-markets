// CCTP V2, Solana devnet side: burn USDC to an Arc testnet address (domain 26), then wait for Circle's attestation.
// The program IDL comes from the chain (fetch-idl.mjs → idl/). Devnet only.
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const IRIS = 'https://iris-api-sandbox.circle.com'
const TMM = new PublicKey('CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe')
const MT = new PublicKey('CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC')
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const SOLANA_DOMAIN = 5, ARC_DOMAIN = 26, FAST = 1000

const pda = (seeds, program) => PublicKey.findProgramAddressSync(seeds.map((s) => (typeof s === 'string' ? Buffer.from(s) : s)), program)[0]

/** An EVM address as the 32-byte Solana pubkey CCTP expects for mintRecipient (left-padded). */
const evmToPubkey = (addr) => new PublicKey(Buffer.concat([Buffer.alloc(12), Buffer.from(addr.slice(2), 'hex')]))

/** The fast-transfer fee for Solana → Arc, in base units, rounded up, with a little headroom. */
async function maxFeeFor(amount) {
  const res = await fetch(`${IRIS}/v2/burn/USDC/fees/${SOLANA_DOMAIN}/${ARC_DOMAIN}`)
  const fees = await res.json()
  const fast = (Array.isArray(fees) ? fees : fees.data ?? []).find((f) => f.finalityThreshold === FAST)
  const bps = Number(fast?.minimumFee ?? 1)
  return BigInt(Math.ceil((Number(amount) * bps) / 10_000)) + 100n
}

export async function burnToArc({ keypairPath, amount, recipient }) {
  const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))))
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
  const idl = JSON.parse(readFileSync(fileURLToPath(new URL('./idl/token_messenger_minter_v2.json', import.meta.url)), 'utf8'))
  const program = new Program(idl, new AnchorProvider(conn, new Wallet(owner), { commitment: 'confirmed' }))
  const event = Keypair.generate()
  const maxFee = await maxFeeFor(amount)
  const sig = await program.methods
    .depositForBurn({
      amount: new BN(amount.toString()),
      destinationDomain: ARC_DOMAIN,
      mintRecipient: evmToPubkey(recipient),
      destinationCaller: PublicKey.default, // anyone may call receiveMessage on Arc
      maxFee: new BN(maxFee.toString()),
      minFinalityThreshold: FAST,
    })
    .accounts({
      owner: owner.publicKey,
      eventRentPayer: owner.publicKey,
      burnTokenAccount: getAssociatedTokenAddressSync(USDC, owner.publicKey),
      messageTransmitter: pda(['message_transmitter'], MT),
      tokenMessenger: pda(['token_messenger'], TMM),
      remoteTokenMessenger: pda(['remote_token_messenger', String(ARC_DOMAIN)], TMM),
      tokenMinter: pda(['token_minter'], TMM),
      burnTokenMint: USDC,
      messageSentEventData: event.publicKey,
    })
    .signers([event])
    .rpc()
  return { sig, maxFee, from: owner.publicKey.toBase58() }
}

/** Poll Circle's attestation service until the burn is attested; returns { message, attestation }. */
export async function waitForAttestation(sig, { timeoutMs = 10 * 60_000 } = {}) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const res = await fetch(`${IRIS}/v2/messages/${SOLANA_DOMAIN}?transactionHash=${sig}`)
    if (res.ok) {
      const m = (await res.json()).messages?.[0]
      if (m?.status === 'complete' && m.attestation && m.attestation !== 'PENDING') return { message: m.message, attestation: m.attestation }
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  throw new Error('attestation timed out')
}

// ── the way back: Arc testnet → Solana devnet ─────────────────────────────────────────────────────────────────

const ARC_USDC = '0x3600000000000000000000000000000000000000'

/** The recipient's USDC token account on Solana, as the bytes32 CCTP takes for mintRecipient on the EVM side. */
export function solanaMintRecipient(ownerBase58) {
  const ata = getAssociatedTokenAddressSync(USDC, new PublicKey(ownerBase58))
  return { ata: ata.toBase58(), bytes32: `0x${Buffer.from(ata.toBytes()).toString('hex')}` }
}

/** Poll Circle's attestation service for a burn on Arc (domain 26). */
export async function waitForArcAttestation(txHash, { timeoutMs = 10 * 60_000 } = {}) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const res = await fetch(`${IRIS}/v2/messages/${ARC_DOMAIN}?transactionHash=${txHash}`)
    if (res.ok) {
      const m = (await res.json()).messages?.[0]
      if (m?.status === 'complete' && m.attestation && m.attestation !== 'PENDING') return { message: m.message, attestation: m.attestation }
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  throw new Error('attestation timed out')
}

/** Mint on Solana devnet: MessageTransmitterV2.receive_message with the TokenMessengerMinterV2 accounts. */
export async function receiveOnSolana({ keypairPath, message, attestation, recipientAta }) {
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))))
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: 'confirmed' })
  const load = (n) => JSON.parse(readFileSync(fileURLToPath(new URL(`./idl/${n}.json`, import.meta.url)), 'utf8'))
  const mt = new Program(load('message_transmitter_v2'), provider)
  const tmm = new Program(load('token_messenger_minter_v2'), provider)
  const msg = Buffer.from(message.replace(/^0x/, ''), 'hex')
  const nonce = msg.subarray(12, 44)
  const remoteDomain = String(ARC_DOMAIN)
  const remoteToken = new PublicKey(Buffer.concat([Buffer.alloc(12), Buffer.from(ARC_USDC.slice(2), 'hex')]))
  const tokenMessenger = pda(['token_messenger'], TMM)
  const feeRecipient = (await tmm.account.tokenMessenger.fetch(tokenMessenger)).feeRecipient
  const meta = (pubkey, isWritable = false) => ({ pubkey, isSigner: false, isWritable })
  return mt.methods
    .receiveMessage({ message: msg, attestation: Buffer.from(attestation.replace(/^0x/, ''), 'hex') })
    .accounts({
      payer: payer.publicKey,
      caller: payer.publicKey,
      authorityPda: PublicKey.findProgramAddressSync([Buffer.from('message_transmitter_authority'), TMM.toBuffer()], MT)[0],
      messageTransmitter: pda(['message_transmitter'], MT),
      usedNonce: PublicKey.findProgramAddressSync([Buffer.from('used_nonce'), nonce], MT)[0],
      receiver: TMM,
    })
    .remainingAccounts([
      meta(tokenMessenger),
      meta(pda(['remote_token_messenger', remoteDomain], TMM)),
      meta(pda(['token_minter'], TMM), true),
      meta(pda(['local_token', USDC.toBuffer()], TMM), true),
      meta(pda(['token_pair', remoteDomain, remoteToken.toBuffer()], TMM)),
      meta(getAssociatedTokenAddressSync(USDC, feeRecipient), true),
      meta(new PublicKey(recipientAta), true),
      meta(pda(['custody', USDC.toBuffer()], TMM), true),
      meta(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')),
      meta(pda(['__event_authority'], TMM)),
      meta(TMM),
    ])
    .rpc()
}

/** USDC balance of a Solana token account, in base units. */
export async function solanaUsdc(ata) {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
  return BigInt((await conn.getTokenAccountBalance(new PublicKey(ata))).value.amount)
}
