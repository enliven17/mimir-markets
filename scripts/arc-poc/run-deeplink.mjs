// End-to-end test of the phone wallet flow (lib/solana/deeplink-adapter.ts) in headless Edge, with Phantom simulated.
//
// The page runs with an Android phone's user agent, so the deeplink Phantom/Solflare rows appear. When the page opens
// a phantom.app/ul link, the browser is answered with 204 (the page stays, as it does when Android hands the link to
// the Phantom app), and this script plays Phantom: it decrypts the request, answers it, and calls our return URL
// exactly as the Android app's launcher does after Phantom opens it. The page must pick the answer up from the relay
// with no reload: connect, then the invite gate's holder proof (signMessage).
//
//   node scripts/arc-poc/run-deeplink.mjs       (dev server on :3123, NEXT_PUBLIC_INVITE_ONLY=1, local database)
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { Keypair } from '@solana/web3.js'
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE ?? 'http://localhost:3123'
const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const user = Keypair.generate()
const enc = nacl.box.keyPair()
let shared = null
const seen = []
const results = []
const check = (name, ok, detail = '') => (results.push(ok), console.log(ok ? 'PASS' : 'FAIL', name, detail))
const encrypt = (obj) => {
  const nonce = nacl.randomBytes(24)
  return { nonce: bs58.encode(nonce), data: bs58.encode(nacl.box.after(new TextEncoder().encode(JSON.stringify(obj)), nonce, shared)) }
}

/** Phantom, simulated: answer one deeplink and "open the redirect link" (what the Android app forwards). */
async function phantom(url) {
  const u = new URL(url)
  const q = u.searchParams
  const method = u.pathname.split('/').pop()
  seen.push(method)
  let answer
  if (method === 'connect') {
    shared = nacl.box.before(bs58.decode(q.get('dapp_encryption_public_key')), enc.secretKey)
    answer = { phantom_encryption_public_key: bs58.encode(enc.publicKey), ...encrypt({ public_key: user.publicKey.toBase58(), session: 's' }) }
  } else if (method === 'signMessage') {
    const req = JSON.parse(new TextDecoder().decode(nacl.box.open.after(bs58.decode(q.get('payload')), bs58.decode(q.get('nonce')), shared)))
    answer = encrypt({ signature: bs58.encode(nacl.sign.detached(bs58.decode(req.message), user.secretKey)) })
  } else throw new Error(`unexpected ${method}`)
  await new Promise((r) => setTimeout(r, 1500)) // the user approving in the wallet
  const back = new URL(q.get('redirect_link'))
  for (const [k, v] of Object.entries(answer)) back.searchParams.set(k, v)
  const res = await fetch(back.toString().replace('https://mimirmarkets.xyz', BASE))
  return res.status
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
try {
  const tab = await browser.newPage()
  tab.setDefaultTimeout(120_000)
  await tab.setUserAgent(UA)
  await tab.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  const errors = []
  tab.on('pageerror', (e) => errors.push(e.message))
  tab.on('console', (m) => { if (process.env.DEBUG && m.type() !== 'debug') console.log('  console:', m.type(), m.text().slice(0, 200)) })
  let loads = 0
  tab.on('load', () => loads++)
  await tab.setRequestInterception(true)
  const returns = []
  tab.on('request', (r) => {
    const url = r.url()
    if (url.startsWith('https://phantom.app/ul/') || url.startsWith('https://solflare.com/ul/')) {
      // Android hands the link to the wallet app; the page itself does not navigate.
      void r.respond({ status: 204 })
      void phantom(url).then((s) => returns.push(s))
      return
    }
    void r.continue()
  })

  // The first-visit Arc announcement would sit over the connect sheet; mark it seen before the page loads.
  await tab.evaluateOnNewDocument(() => localStorage.setItem('mimir:arc-launch-seen', '1'))
  await tab.goto(`${BASE}/en/arena`, { waitUntil: 'networkidle2', timeout: 300_000 })
  const startLoads = loads

  await (await tab.waitForSelector('::-p-xpath(//button[contains(., "Connect") or contains(., "Select Wallet")])')).click()
  await tab.waitForSelector('::-p-xpath(//div[@role="dialog"]//li//button[contains(., "Phantom")])')
  const rows = await tab.$$eval('[role="dialog"] li button', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim()))
  check('phone sheet lists Phantom and Solflare first', /^Phantom/.test(rows[0] ?? '') && /^Solflare/.test(rows[1] ?? ''), JSON.stringify(rows))
  check('no "open in wallet browser" links', !(await tab.$('a[href*="/ul/browse/"]')))
  await new Promise((r) => setTimeout(r, 600)) // the sheet settles before the tap
  await (await tab.waitForSelector('::-p-xpath(//div[@role="dialog"]//li//button[contains(., "Phantom")])')).click()

  await tab.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 60_000 })
  check('connected through the relay, page not reloaded', loads === startLoads && seen[0] === 'connect', `loads ${loads - startLoads}`)

  await (await tab.waitForSelector('::-p-xpath(//button[normalize-space(.)="Sign in"])')).click()
  await tab.waitForSelector('input[placeholder="MIMIR-XXXX-XXXX"]', { timeout: 60_000 })
  check('holder proof signed through the relay (signMessage)', seen.includes('signMessage') && loads === startLoads)
  check('return route accepted both answers', returns.length === 2 && returns.every((s) => s === 200), returns.join(','))
  const stored = await tab.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mimir-deeplink:')))
  check('session kept for reloads', stored.includes('mimir-deeplink:phantom'))
  check('no page exceptions', errors.length === 0, errors.join(' | ').slice(0, 200))
  await tab.screenshot({ path: `${process.env.TEMP}/deeplink-after.png` })
} catch (e) {
  check('run', false, `${e.message} seen=${seen.join(',')}`)
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
