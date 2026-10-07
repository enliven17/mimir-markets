// End-to-end test of the app's /wallet page (lib/arc, components/arc) on Arc testnet + Solana devnet.
//
// Headless Edge with a virtual WebAuthn authenticator. Every request to https://mimirmarkets.xyz/* is answered by
// the local `next dev` (the browser's origin stays mimirmarkets.xyz, the only host Circle's Console accepts), so
// nothing is deployed. A Wallet Standard test wallet is injected; it signs in node with the devnet keypair at
// ~/.config/solana/talos-deploy.json (devnet USDC only, at most 1 USDC per run).
//
// Steps: create a passkey account → link it to the Solana wallet (both signatures; the Arc one is checked with the
// server's own verifyArcSignature) → turn on recovery → deposit 1 USDC → withdraw 0.5 → recover the account with the
// phrase on a fresh "device" (new passkey, same address).
//
// Without DATABASE_URL the bind route answers 503 (checked); the script then stands in for the database on
// /api/arc/bind only, and says so.
//
//   node --import tsx scripts/arc-poc/run-app.mjs        (from the repo root; NEXT_PUBLIC_CIRCLE_CLIENT_KEY in .env.local)
//   PORT=3123 BASE=http://localhost:3123 to reuse a running dev server.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import nacl from 'tweetnacl'
import puppeteer from 'puppeteer-core'
import { injectWallet } from './inject-wallet.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ORIGIN = 'https://mimirmarkets.xyz'
const PORT = Number(process.env.PORT ?? 3123)
const BASE = process.env.BASE ?? `http://localhost:${PORT}`
const WALLET_NAME = 'Mimir E2E'
const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/talos-deploy.json'), 'utf8'))))
const SOLANA = keypair.publicKey.toBase58()

const { verifyArcSignature } = await import('../../lib/server/arc-accounts.ts')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const results = { solana: SOLANA }

// ── dev server ────────────────────────────────────────────────────────────────────────────────────────────────
let dev = null
async function up() {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })).status < 500
  } catch {
    return false
  }
}
if (!(await up())) {
  log('starting next dev on', PORT)
  dev = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', String(PORT)], { cwd: ROOT, shell: true, stdio: 'ignore' })
  const until = Date.now() + 180_000
  while (!(await up())) {
    if (Date.now() > until) throw new Error('next dev did not start')
    await new Promise((r) => setTimeout(r, 2000))
  }
}

// ── browser ───────────────────────────────────────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  protocolTimeout: 600_000,
})

/** The database the bind route would have, when this deploy has none. */
const fakeDb = new Map()

async function newTab() {
  const ctx = await browser.createBrowserContext()
  const tab = await ctx.newPage()
  tab.setDefaultTimeout(180_000)
  tab.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !/Failed to load resource|webpack-hmr|Download the React DevTools|pubKeyCredParams|report-only/i.test(t)) log('  page error:', t.slice(0, 300))
  })
  tab.on('pageerror', (e) => log('  page exception:', e.message.slice(0, 300)))
  const cdp = await tab.createCDPSession()
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  })

  // The injected wallet signs here, in node.
  await tab.exposeFunction('__e2eSign', (kind, b64) => {
    const bytes = Buffer.from(b64, 'base64')
    if (kind === 'msg') return Buffer.from(nacl.sign.detached(bytes, keypair.secretKey)).toString('base64')
    const tx = VersionedTransaction.deserialize(bytes)
    tx.sign([keypair])
    return Buffer.from(tx.serialize()).toString('base64')
  })
  await tab.evaluateOnNewDocument(injectWallet, WALLET_NAME, SOLANA, [...keypair.publicKey.toBytes()])

  await tab.setRequestInterception(true)
  tab.on('request', (r) => void proxy(r).catch((e) => (log('  proxy failed', r.url(), e.message), r.abort().catch(() => {}))))
  return tab
}

async function proxy(r) {
  const url = r.url()
  if (!url.startsWith(`${ORIGIN}/`)) return r.continue()
  const path = url.slice(ORIGIN.length)
  if (path.startsWith('/api/arc/bind')) return bindRoute(r, path)
  const headers = { ...r.headers() }
  for (const h of ['host', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'accept-encoding']) delete headers[h]
  const res = await fetch(`${BASE}${path}`, { method: r.method(), headers, body: r.postData(), redirect: 'manual' })
  const out = {}
  res.headers.forEach((v, k) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = k === 'location' ? v.replace(BASE, ORIGIN) : v
  })
  return r.respond({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) })
}

/** The real route first; when it says the database is missing, check the Arc signature ourselves and keep the row here. */
async function bindRoute(r, path) {
  const res = await fetch(`${BASE}${path}`, { method: r.method(), headers: { 'content-type': 'application/json' }, body: r.postData() })
  const text = await res.text()
  if (res.status !== 503) return r.respond({ status: res.status, contentType: 'application/json', body: text })
  results.bindRoute503 = text
  if (r.method() === 'GET') {
    const solana = new URL(`${ORIGIN}${path}`).searchParams.get('solana')
    const binding = fakeDb.get(solana)
    return r.respond({ status: binding ? 200 : 404, contentType: 'application/json', body: JSON.stringify(binding ? { binding } : { error: 'none' }) })
  }
  // The route only reaches the database check after the Solana signature verified (401 otherwise).
  const body = JSON.parse(r.postData())
  const message = ['Mimir Arc account', `solana: ${body.solana}`, `arc: ${body.arc}`, `signedAt: ${body.signedAt}`, 'This links your Solana wallet to your Arc account on Mimir. It moves no funds.'].join('\n')
  const ok = await verifyArcSignature(body.arc, message, body.arcSignature)
  results.arcSignatureVerified = ok
  results.arcSignatureBytes = (body.arcSignature.length - 2) / 2
  log('  bind: route answered 503 (no DATABASE_URL); Solana signature passed the route; Arc signature verifyArcSignature =', ok)
  if (!ok) return r.respond({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'arc signature did not verify' }) })
  const binding = { solana: body.solana, arc: body.arc, boundAt: Date.now() }
  fakeDb.set(body.solana, binding)
  return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ binding }) })
}


// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const byText = (text, tag = 'button') => `::-p-xpath(//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})])`
async function click(tab, text) {
  const el = await tab.waitForSelector(`${byText(text)}:not([disabled])`)
  await el.click()
}
async function links(tab) {
  return tab.$$eval('a[href*="explorer.solana.com/tx/"], a[href*="arcscan.app/tx/"]', (as) => as.map((a) => a.href))
}
async function transfer(tab, kind, amount) {
  if (kind === 'withdraw') await click(tab, 'Withdraw to Solana')
  const input = await tab.waitForSelector('input[inputmode="decimal"]')
  await input.click({ count: 3 })
  await input.type(amount)
  const t0 = Date.now()
  await (await tab.waitForSelector('form button[type="submit"]:not([disabled])')).click()
  await tab.waitForFunction(
    (k) => document.querySelector(`[data-transfer-kind="${k}"][data-transfer-step="done"]`) || document.querySelector('[role="alert"]'),
    { timeout: 20 * 60_000, polling: 1000 },
    kind,
  )
  const err = await tab.$eval('[role="alert"]', (e) => e.textContent).catch(() => null)
  if (err) throw new Error(`${kind} failed: ${err}`)
  const urls = await links(tab)
  log(`${kind} ${amount} USDC done in ${Math.round((Date.now() - t0) / 1000)}s`, urls.join(' '))
  return { seconds: Math.round((Date.now() - t0) / 1000), txs: urls }
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────────────────
let code = 0
let current = null
try {
  const tab = (current = await newTab())
  await tab.goto(`${ORIGIN}/en/wallet`, { waitUntil: 'domcontentloaded', timeout: 300_000 })
  log('page loaded; solana wallet', SOLANA)

  await click(tab, 'Create your Arc account')
  const addrEl = await tab.waitForSelector('[data-testid="arc-address"]')
  results.arc = (await addrEl.evaluate((e) => e.textContent)).replace(/\s*\(opens in a new tab\)/, '').trim()
  log('passkey account', results.arc)

  await click(tab, 'Link to your Solana wallet')
  await tab.waitForSelector('[data-testid="arc-linked"]')
  log('linked')

  await click(tab, 'Create my phrase')
  const words = await tab.$$eval('ol[aria-label="Recovery phrase"] li', (lis) => lis.map((li) => li.textContent.replace(/^\d+\./, '').trim()))
  if (words.length !== 12) throw new Error(`expected 12 words, got ${words.length}`)
  await tab.click('input[type="checkbox"]')
  await click(tab, 'Turn on recovery')
  await tab.waitForFunction(() => !document.querySelector('ol[aria-label="Recovery phrase"]'), { timeout: 180_000 })
  const recoveryErr = await tab.$eval('[role="alert"]', (e) => e.textContent).catch(() => null)
  if (recoveryErr) throw new Error(`recovery: ${recoveryErr}`)
  log('recovery phrase registered')

  results.deposit = await transfer(tab, 'deposit', '1')
  results.withdraw = await transfer(tab, 'withdraw', '0.5')

  // A new device: no stored passkey, recover with the phrase.
  const fresh = (current = await newTab())
  await fresh.goto(`${ORIGIN}/en/wallet`, { waitUntil: 'domcontentloaded', timeout: 300_000 })
  await click(fresh, 'Lost your passkey?')
  await (await fresh.waitForSelector('textarea')).type(words.join(' '))
  await (await fresh.waitForSelector('form button[type="submit"]:not([disabled])')).click()
  const recEl = await fresh.waitForSelector('[data-testid="arc-address"]', { timeout: 300_000 })
  results.recoveredAddress = (await recEl.evaluate((e) => e.textContent)).replace(/\s*\(opens in a new tab\)/, '').trim()
  results.recoverySameAccount = results.recoveredAddress.toLowerCase() === results.arc.toLowerCase()
  log('recovered account', results.recoveredAddress, results.recoverySameAccount ? '(same)' : '(DIFFERENT)')
  if (!results.recoverySameAccount) throw new Error('recovery landed on a different account')
  // The new passkey really owns the account: it signs a sponsored operation.
  await fresh.waitForSelector('[data-testid="arc-linked"]')
  results.withdrawAfterRecovery = await transfer(fresh, 'withdraw', '0.1')

  // 360 px wide: nothing scrolls sideways. Then axe (WCAG 2.2 AA) on the page body.
  await tab.setViewport({ width: 360, height: 800 })
  await new Promise((r) => setTimeout(r, 500))
  results.overflowAt360 = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await tab.addScriptTag({ path: join(ROOT, 'node_modules/axe-core/axe.min.js') })
  const axe = await tab.evaluate(async () => {
    const r = await window.axe.run(document.querySelector('main'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }))
  })
  results.axeViolations = axe
  log('360px overflow', results.overflowAt360, 'px; axe violations', JSON.stringify(axe))
} catch (e) {
  log('FAILED', e?.message ?? e)
  code = 1
  if (current) {
    log('page text:', (await current.evaluate(() => document.querySelector('main')?.innerText ?? '').catch(() => '')).slice(0, 1500))
    if (process.env.SHOT) await current.screenshot({ path: process.env.SHOT, fullPage: true }).catch(() => {})
  }
} finally {
  console.log(JSON.stringify(results, null, 2))
  await browser.close()
  if (dev) spawn('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { shell: true })
  process.exit(code)
}
