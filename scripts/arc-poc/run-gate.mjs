// End-to-end test of the invite-only gate (components/access/AccessGate.tsx) in a browser, desktop and phone width.
//
// Needs a dev server started with the gate on and a local database:
//   NEXT_PUBLIC_INVITE_ONLY=1 DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx next dev -p 3123
//   node scripts/arc-poc/run-gate.mjs          (from the repo root; SHOTS=<dir> for screenshots)
//
// Steps: a gated page shows the gate and a public one does not → sign in with the injected Solana wallet (it holds
// no $MIMIR) → a wrong code is refused → a fresh code lets the wallet in → the dashboard hands it its own codes.
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import pg from 'pg'
import puppeteer from 'puppeteer-core'
import { injectWallet } from './inject-wallet.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3123'
const SHOTS = process.env.SHOTS ?? join(process.env.TEMP ?? '.', 'mimir-gate')
const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/talos-deploy.json'), 'utf8'))))
const SOLANA = keypair.publicKey.toBase58()
const CODE = 'MIMIR-E2EK-GATE'
mkdirSync(SHOTS, { recursive: true })

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres' })
await db.connect()
// A clean start: this wallet is not in yet, and one unused code from someone who is.
await db.query('DELETE FROM access_grants WHERE wallet = $1', [SOLANA])
await db.query('DELETE FROM access_invites WHERE owner = $1 OR used_by = $1 OR code = $2', [SOLANA, CODE])
await db.query('INSERT INTO access_invites (code, owner, created_at) VALUES ($1, $2, $3)', [CODE, 'E2EInviter1111111111111111111111111111111111', Date.now()])

const results = []
const check = (name, ok, detail = '') => (results.push({ name, ok }), console.log(ok ? 'PASS' : 'FAIL', name, detail))
const byText = (text, tag = '*') => `::-p-xpath(//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})])`
const has = (tab, text) => tab.$(byText(text)).then(Boolean)
// The page has other forms: submit the gate's own, after React has the typed value.
async function submit(tab, input) {
  await new Promise((r) => setTimeout(r, 500))
  await input.evaluate((e) => e.form.requestSubmit())
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
try {
  const tab = await (await browser.createBrowserContext()).newPage()
  tab.setDefaultTimeout(120_000)
  const errors = []
  tab.on('pageerror', (e) => errors.push(e.message))
  await tab.exposeFunction('__e2eSign', (_kind, b64) => Buffer.from(nacl.sign.detached(Buffer.from(b64, 'base64'), keypair.secretKey)).toString('base64'))
  await tab.evaluateOnNewDocument(injectWallet, 'Mimir E2E', SOLANA, [...keypair.publicKey.toBytes()])

  for (const [w, h, label] of [[1280, 900, 'desktop'], [390, 844, 'mobile']]) {
    await tab.setViewport({ width: w, height: h })
    await tab.goto(`${BASE}/en/docs`, { waitUntil: 'networkidle2', timeout: 300_000 })
    check(`${label}: public page is not gated`, !(await has(tab, 'Mimir is opening in waves.')))
    await tab.goto(`${BASE}/en/arena`, { waitUntil: 'networkidle2', timeout: 300_000 })
    await tab.waitForSelector(byText('Mimir is opening in waves.'))
    check(`${label}: gated page shows the gate`, true)
    const overflow = await tab.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    check(`${label}: no horizontal overflow`, !overflow)
    await tab.screenshot({ path: join(SHOTS, `gate-${label}.png`) })
  }
  await tab.setViewport({ width: 1280, height: 900 })

  // The wallet is remembered, so the gate asks for the proof next.
  const connect = await tab.$(byText('Select Wallet', 'button')).catch(() => null)
  if (connect) {
    await connect.click()
    await (await tab.waitForSelector(byText('Mimir E2E', 'button'))).click()
  }
  await (await tab.waitForSelector(`${byText('Sign in', 'button')}:not([disabled])`)).click()
  const input = await tab.waitForSelector('input[placeholder="MIMIR-XXXX-XXXX"]')
  check('signed in, no $MIMIR: asked for a code', true)

  // The page has other forms; submit the gate's own.
  await input.type('MIMIR-ZZZZ-ZZZZ')
  await submit(tab, input)
  await tab.waitForSelector('p.text-danger')
  check('a wrong code is refused', true, await tab.$eval('p.text-danger', (e) => e.textContent))

  await input.focus()
  await input.evaluate((e) => e.select())
  await tab.keyboard.press('Backspace')
  await input.type(CODE.toLowerCase())
  await submit(tab, input)
  await tab.waitForFunction(() => !document.body.innerText.includes('Mimir is opening in waves.'))
  check('a valid code lets the wallet in', true)
  await tab.screenshot({ path: join(SHOTS, 'gate-in.png') })

  const used = (await db.query('SELECT used_by FROM access_invites WHERE code = $1', [CODE])).rows[0]?.used_by
  check('the code is spent on this wallet', used === SOLANA)

  await tab.goto(`${BASE}/en/dashboard`, { waitUntil: 'networkidle2', timeout: 300_000 })
  await tab.waitForFunction(() => /MIMIR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/.test(document.body.innerText), { timeout: 120_000 })
  const codes = await tab.evaluate(() => [...new Set(document.body.innerText.match(/MIMIR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/g) ?? [])])
  check('the invitee gets its own codes on the dashboard', codes.length >= 2, codes.join(' '))
  await tab.screenshot({ path: join(SHOTS, 'gate-dashboard.png'), fullPage: true })
  check('no page exceptions', errors.length === 0, errors.join(' | ').slice(0, 300))
} catch (e) {
  check('run', false, e.message)
} finally {
  await browser.close()
  await db.end()
}
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(failed ? 1 : 0)
