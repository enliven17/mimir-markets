// One-off: copy the retired Postgres (Neon) tables into the backend's appStore (convex/appStore.ts).
//
//   cd scripts/migrate && npm install
//   DATABASE_URL=<neon url> node neon-to-convex.mjs                 back up every table, write the import file
//   DATABASE_URL=<neon url> node neon-to-convex.mjs --import [--prod] [--append]
//
// 1. Backs up EVERY table (retired ones too) as JSON to %USERPROFILE%\mimir-neon-backup-<date>\ (outside the repo).
// 2. Turns the tables the app still uses into appStore rows ({ t, k, i1, i2, d, at }: lib/server/store.ts) in
//    <backup>\appStore.jsonl. Short-lived tables (nonces, stored replies, rate-limit windows, the wallet relay) are
//    backed up but not carried over.
// 3. With --import: `npx convex import --table appStore` (--replace by default: the import is the cutover's source of
//    truth; --append adds instead), into the dev deployment, or prod with --prod. Then prints row counts both ways.
// Nothing in Postgres is changed or deleted. The URL is read from the environment and never printed.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const url = process.env.DATABASE_URL?.trim()
if (!url) throw new Error('DATABASE_URL is not set')
const args = new Set(process.argv.slice(2))
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const day = new Date().toISOString().slice(0, 10)
const OUT = join(homedir(), `mimir-neon-backup-${day}`)
mkdirSync(OUT, { recursive: true })

const db = new pg.Client({ connectionString: url, ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false } })
await db.connect()

// ── 1. backup ───────────────────────────────────────────────────────────────
const tables = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")).rows.map((r) => r.table_name)
const data = {}
for (const t of tables) {
  data[t] = (await db.query(`SELECT * FROM "${t}"`)).rows
  writeFileSync(join(OUT, `${t}.json`), JSON.stringify(data[t], null, 1))
}
await db.end()
console.log(`backed up ${tables.length} tables to ${OUT}`)

// ── 2. transform ────────────────────────────────────────────────────────────
const num = (v) => (v === null || v === undefined ? null : Number(v))
const str = (v) => (v === null || v === undefined ? null : String(v))
const rows = []
const add = (t, k, d, at, i1, i2) => rows.push({ t, k: String(k), d, at: Number(at) || 0, ...(i1 ? { i1: String(i1) } : {}), ...(i2 ? { i2: String(i2) } : {}) })
const of = (t) => data[t] ?? []

for (const r of of('arc_accounts')) {
  add('arc_accounts', r.solana, { solana: r.solana, arc: r.arc, credential_id: str(r.credential_id), bound_at: num(r.bound_at) }, r.bound_at, r.arc)
  add('arc_owners', r.arc, { arc: r.arc, solana: r.solana }, r.bound_at)
}
for (const r of of('access_grants')) add('access_grants', r.wallet, { wallet: r.wallet, via: r.via, code: str(r.code), granted_at: num(r.granted_at) }, r.granted_at, r.via)
for (const r of of('access_invites'))
  add('access_invites', r.code, { code: r.code, owner: r.owner, created_at: num(r.created_at), used_by: str(r.used_by), used_at: num(r.used_at) }, r.created_at, r.owner)
for (const r of of('agent_registry'))
  add(
    'agent_registry',
    r.agent_id,
    {
      agent_id: r.agent_id,
      owner_wallet: r.owner_wallet,
      operator_wallet: r.operator_wallet,
      payout_wallet: r.payout_wallet,
      display_name: r.display_name ?? '',
      authority_level: num(r.authority_level) ?? 0,
      capabilities: r.capabilities ?? '',
      status: r.status ?? 'active',
      limits_json: r.limits_json ?? '{}',
      created_at: num(r.created_at) ?? 0,
      updated_at: num(r.updated_at) ?? 0,
      last_seen_at: num(r.last_seen_at),
      arc_operator: str(r.arc_operator),
      chat_url: str(r.chat_url),
      chat_price_units: num(r.chat_price_units) ?? 0,
      chat_secret: str(r.chat_secret),
      bio: r.bio ?? '',
    },
    r.created_at,
    r.owner_wallet,
    r.operator_wallet,
  )
for (const r of of('agent_api_keys'))
  add('agent_api_keys', r.key_hash, { key_hash: r.key_hash, agent_id: r.agent_id, key_prefix: r.key_prefix, label: r.label ?? '', created_at: num(r.created_at) ?? 0, revoked_at: num(r.revoked_at) }, r.created_at, r.agent_id)
const now = Date.now()
const budgets = new Map()
for (const r of of('agent_request_audit')) {
  const id = String(r.id)
  add('agent_request_audit', id, { id, agent_id: r.agent_id, action: r.action, ok: Boolean(r.ok), reason: str(r.reason), amount_units: String(r.amount_units ?? '0'), at: num(r.at) ?? 0 }, r.at, r.agent_id)
  if (r.ok && Number(r.at) > now - 86_400_000 && String(r.amount_units ?? '0') !== '0') {
    const b = budgets.get(r.agent_id) ?? []
    b.push({ id, units: String(r.amount_units), at: Number(r.at) })
    budgets.set(r.agent_id, b)
  }
}
for (const [agent, entries] of budgets) add('agent_budget', agent, { agent_id: agent, version: 1, entries }, now)
for (const r of of('agent_payments'))
  add('agent_payments', r.tx_hash, { tx_hash: r.tx_hash, agent_id: r.agent_id, owner_wallet: r.owner_wallet, amount_wei: String(r.amount_wei), paid_at: num(r.paid_at) }, r.paid_at, r.agent_id)
for (const r of of('baskets'))
  add('baskets', r.id, { id: r.id, name: r.name, thesis: r.thesis ?? '', creator_wallet: r.creator_wallet, members_json: r.members_json ?? '[]', signature: r.signature ?? '', created_at: num(r.created_at) ?? 0 }, r.created_at, r.creator_wallet)
for (const r of of('basket_subscriptions'))
  add(
    'basket_subscriptions',
    `${r.basket_id}:${r.follower}`,
    { basket_id: r.basket_id, follower: r.follower, per_market_cap_usdc: Number(r.per_market_cap_usdc ?? 0), signature: r.signature ?? '', updated_at: num(r.updated_at) ?? 0 },
    r.updated_at,
    r.basket_id,
    r.follower,
  )
for (const r of of('copy_permissions'))
  add(
    'copy_permissions',
    r.id,
    {
      id: r.id,
      follower: r.follower,
      signal_agent_id: r.signal_agent_id,
      execution_agent_id: r.execution_agent_id,
      active: Boolean(r.active),
      expires_at: num(r.expires_at) ?? 0,
      policy_json: r.policy_json ?? '{}',
      signature: r.signature ?? '',
      signed_at: num(r.signed_at) ?? 0,
      created_at: num(r.created_at) ?? 0,
      revoked_at: num(r.revoked_at),
    },
    r.created_at,
    r.follower,
    r.execution_agent_id,
  )
for (const r of of('copy_executions')) {
  const k = r.executed ? `${r.permission_id}:${r.claim_id}:executed` : `${r.permission_id}:${r.claim_id}:${r.id}`
  add('copy_executions', k, { permission_id: r.permission_id, claim_id: Number(r.claim_id), executed: Boolean(r.executed), skip_reason: str(r.skip_reason), stake_usdc: Number(r.stake_usdc ?? 0), tx_signature: str(r.tx_signature), at: num(r.at) ?? 0 }, r.at, r.permission_id)
}
for (const r of of('copy_reservations'))
  add('copy_reservations', `${r.permission_id}:${r.claim_id}`, { permission_id: r.permission_id, claim_id: Number(r.claim_id), stake_usdc: Number(r.stake_usdc ?? 0), at: num(r.at) ?? 0, expires_at: num(r.expires_at) ?? 0 }, r.at, r.permission_id)
for (const r of of('telegram_chats')) {
  const d = {
    chat_id: Number(r.chat_id),
    wallet: str(r.wallet),
    new_markets: r.new_markets !== false,
    link_code: str(r.link_code),
    link_expires_at: num(r.link_expires_at) ?? 0,
    blocked: Boolean(r.blocked),
    created_at: num(r.created_at) ?? 0,
    alert_results: r.alert_results !== false,
    alert_verdicts: r.alert_verdicts !== false,
    alert_payouts: r.alert_payouts !== false,
  }
  add('telegram_chats', String(r.chat_id), d, r.created_at, r.wallet, r.link_code)
}
for (const r of of('campaign_invites')) {
  add('campaign_invites', r.wallet, { wallet: r.wallet, code: r.code, referrer: str(r.referrer), created_at: num(r.created_at) ?? 0 }, r.created_at, r.code, r.referrer)
  add('campaign_codes', r.code, { code: r.code, wallet: r.wallet }, r.created_at)
}
for (const r of of('app_meta')) add('app_meta', r.key, { key: r.key, value: r.value, updated_at: num(r.updated_at) ?? 0 }, r.updated_at)

const file = join(OUT, 'appStore.jsonl')
writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

const counts = {}
for (const r of rows) counts[r.t] = (counts[r.t] ?? 0) + 1
const MIGRATED = ['arc_accounts', 'access_grants', 'access_invites', 'agent_registry', 'agent_api_keys', 'agent_request_audit', 'agent_payments', 'baskets', 'basket_subscriptions', 'copy_permissions', 'copy_executions', 'copy_reservations', 'telegram_chats', 'campaign_invites', 'app_meta']
console.log('\ntable                    postgres  appStore')
for (const t of tables) console.log(`${t.padEnd(24)} ${String(data[t].length).padStart(8)}  ${MIGRATED.includes(t) ? String(counts[t] ?? 0).padStart(8) : '  backup'}`)
for (const t of ['arc_owners', 'agent_budget', 'campaign_codes']) console.log(`${(t + ' (derived)').padEnd(24)} ${''.padStart(8)}  ${String(counts[t] ?? 0).padStart(8)}`)
console.log(`\n${rows.length} rows → ${file}`)

// ── 3. import ───────────────────────────────────────────────────────────────
if (args.has('--import')) {
  const cli = ['convex', 'import', '--table', 'appStore', args.has('--append') ? '--append' : '--replace', '-y', ...(args.has('--prod') ? ['--prod'] : []), file]
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', cli, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  console.log(`imported into the ${args.has('--prod') ? 'prod' : 'dev'} deployment`)
}
