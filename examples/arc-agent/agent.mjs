// A bring-your-own-agent example for Mimir on Arc, using only the public agent API (POST /api/agents/v1/<action>).
//
// What it does, end to end:
//   1. keys: a Solana ed25519 key (the agent's identity; it signs every API request) and an EVM key (its Arc
//      operator, which signs and pays for its own Arc transactions). Both are created on first run in KEYS_FILE.
//   2. register: pays the deploy fee in USDC on Arc from the operator ($1, less for $MIMIR holders), then registers
//      with authority to stake, naming the operator. Skipped once registered.
//   3. read: lists live VS markets and picks one to challenge (a deliberately simple rule: the one with the most room
//      left, closing soonest), skipping markets it already holds.
//   4. act: asks the API for the challenge, gets one unsigned Arc transaction back, checks it, signs it with the
//      operator key and sends it. Mimir never sees a key.
//   5. verify: polls listPositions until the index shows the new position.
//
//   node examples/arc-agent/agent.mjs            (MIMIR_URL defaults to http://localhost:3123, STAKE_USDC to 0.1)
// The operator needs a little USDC on Arc testnet (faucet.circle.com, "Arc Testnet"): the fee plus the stake.
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { createPublicClient, createWalletClient, decodeFunctionData, http, parseAbi, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const MIMIR = (process.env.MIMIR_URL ?? 'http://localhost:3123').replace(/\/$/, '')
const KEYS_FILE = process.env.KEYS_FILE ?? join(homedir(), '.mimir-example-agent.json')
const STAKE_USDC = Number(process.env.STAKE_USDC ?? '0.1')
const AGENT_ID = process.env.AGENT_ID
const ARC_RPC = process.env.ARC_RPC ?? 'https://rpc.testnet.arc.network'
const arc = { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [ARC_RPC] } } }
const log = (...a) => console.log('[agent]', ...a)

// ── keys ────────────────────────────────────────────────────────────────────
async function loadKeys() {
  try {
    const k = JSON.parse(await readFile(KEYS_FILE, 'utf8'))
    return { ...k, solana: nacl.sign.keyPair.fromSecretKey(bs58.decode(k.solanaSecret)) }
  } catch {
    const solana = nacl.sign.keyPair()
    const k = { agentId: AGENT_ID ?? `byoa-${randomUUID().slice(0, 8)}`, solanaSecret: bs58.encode(solana.secretKey), evmKey: generatePrivateKey() }
    await writeFile(KEYS_FILE, JSON.stringify(k, null, 2), { mode: 0o600 })
    log('new keys written to', KEYS_FILE)
    return { ...k, solana }
  }
}

// ── the signed envelope (lib/agents/api.ts: canonical body, sha256, the readable request text) ──────────────
function canonicalize(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canonicalize(x)}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}
const bodyHash = (body) => bytesToHex(sha256(utf8ToBytes(canonicalize(body ?? {}))))
const sign = (keys, text) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(text), keys.solana.secretKey))

async function call(keys, action, body = {}) {
  const env = { version: 'v1', agentId: keys.agentId, action, idempotencyKey: randomUUID(), nonce: randomUUID(), signedAt: Date.now(), body }
  env.signature = sign(keys, ['Mimir Agent API request (Solana)', `version: ${env.version}`, `agent: ${env.agentId}`, `action: ${env.action}`, `idempotency: ${env.idempotencyKey}`, `nonce: ${env.nonce}`, `signedAt: ${env.signedAt}`, `bodyHash: ${bodyHash(env.body)}`].join('\n'))
  const res = await fetch(`${MIMIR}/api/agents/v1/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(env) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${action} → ${res.status} ${json.reason ?? ''}: ${json.message ?? JSON.stringify(json)}`)
  return json
}

// ── main ────────────────────────────────────────────────────────────────────
const keys = await loadKeys()
const owner = bs58.encode(keys.solana.publicKey)
const operator = privateKeyToAccount(keys.evmKey)
const pub = createPublicClient({ chain: arc, transport: http() })
const wallet = createWalletClient({ account: operator, chain: arc, transport: http() })
log(`agent ${keys.agentId} · identity ${owner} · Arc operator ${operator.address} (${Number(await pub.getBalance({ address: operator.address })) / 1e18} USDC)`)

// 2. register (once)
let registered = true
try {
  await call(keys, 'heartbeat')
} catch (e) {
  if (!/unknown_agent/.test(e.message)) throw e
  registered = false
}
if (!registered) {
  // The fee recipient is the market contract's; the API refuses a payment sent anywhere else.
  const v3 = process.env.MIMIR_V3_ADDRESS ?? '0x69878745764d3011bb575078d94dfda82589aeb6'
  const treasury = await pub.readContract({ address: v3, abi: parseAbi(['function feeRecipient() view returns (address)']), functionName: 'feeRecipient' })
  const feeUsdc = Number(process.env.DEPLOY_FEE_USDC ?? '1')
  let paymentTx
  if (feeUsdc > 0) {
    paymentTx = await wallet.writeContract({ address: '0x3600000000000000000000000000000000000000', abi: parseAbi(['function transfer(address,uint256) returns (bool)']), functionName: 'transfer', args: [treasury, BigInt(Math.round(feeUsdc * 1e6))] })
    await pub.waitForTransactionReceipt({ hash: paymentTx })
    log(`paid the ${feeUsdc} USDC deploy fee: ${paymentTx}`)
  }
  const operatorSignature = sign(keys, `Mimir agent operator proof (Solana)\nagent: ${keys.agentId}\noperator: ${owner}`)
  const reg = await call(keys, 'register', {
    ownerWallet: owner, operatorWallet: owner, payoutWallet: owner, displayName: 'BYOA example',
    authorityLevel: 3, capabilities: [], operatorSignature, arcOperator: operator.address, ...(paymentTx ? { paymentTx } : {}),
  })
  log(`registered: ${reg.agent?.agentId} (${reg.agent?.status})`)
}

// 3. read and decide
const { markets } = await call(keys, 'listClaims', { state: 'live', kind: 'vs', limit: 50 })
const held = new Set(((await call(keys, 'listPositions')).positions ?? []).map((p) => `${p.kind}:${p.marketId}`))
const now = Math.floor(Date.now() / 1000)
const room = (m) => BigInt(m.stakeA) * 5n - BigInt(m.stakeB)
const pick = markets
  .filter((m) => m.deadline > now + 600 && !held.has(`vs:${m.marketId}`) && room(m) >= parseEther(String(STAKE_USDC)))
  .sort((a, b) => Number(room(b) - room(a)) || a.deadline - b.deadline)[0]
if (!pick) {
  log(`no live VS market to challenge (${markets.length} listed); done`)
  process.exit(0)
}
log(`challenging VS #${pick.marketId}: "${pick.question}" (taking "${pick.labelB}")`)

// 4. act: one unsigned tx back; check it before signing
const prepared = await call(keys, 'challenge', { claimId: pick.marketId, stakeUsdc: STAKE_USDC, kind: 'vs' })
const [tx] = prepared.transactions
const decoded = decodeFunctionData({ abi: parseAbi(['function challengeClaim(uint256,uint256,string,address) payable']), data: tx.data })
if (decoded.args[0] !== BigInt(pick.marketId) || BigInt(tx.value) !== parseEther(String(STAKE_USDC)) || tx.chainId !== arc.id) throw new Error('the prepared transaction is not the challenge asked for; not signing')
const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) })
const rc = await pub.waitForTransactionReceipt({ hash })
log(`sent ${hash}: ${rc.status}`)

// 5. verify through the API
for (let i = 0; i < 12; i++) {
  const { positions = [] } = await call(keys, 'listPositions')
  const mine = positions.find((p) => p.kind === 'vs' && p.marketId === pick.marketId)
  if (mine) {
    log(`position on VS #${pick.marketId}: side ${mine.side}, ${Number(mine.amount) / 1e18} USDC staked (after the entry fee)`)
    process.exit(0)
  }
  await new Promise((r) => setTimeout(r, 5000))
}
log('the index has not shown the position yet; it updates every 30 s')
