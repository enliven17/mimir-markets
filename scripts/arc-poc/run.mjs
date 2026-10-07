// Runs page.html in headless Edge with a virtual WebAuthn authenticator (no Face ID needed). Circle Console only
// accepts real domains, so the page is served at https://mimirmarkets.xyz by intercepting that request in the
// browser: nothing is deployed and the live site is untouched; the browser just sees that origin (a secure context
// for WebAuthn, and the origin Circle checks the client key against). Console: allowed domain mimirmarkets.xyz.
// Reads CIRCLE_CLIENT_KEY from ../../.env.local.
//   cd scripts/arc-poc && npm install && node run.mjs
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const env = await readFile(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8').catch(() => '')
const key = /^CIRCLE_CLIENT_KEY=(.+)$/m.exec(env)?.[1]?.trim()
if (!key) throw new Error('add CIRCLE_CLIENT_KEY=TEST_API_KEY:... to .env.local')

const page = await readFile(fileURLToPath(new URL('./page.html', import.meta.url)), 'utf8')
const ORIGIN = 'https://mimirmarkets.xyz' // Circle matches the host exactly: a subdomain is refused

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
})
const tab = await browser.newPage()
tab.on('console', (m) => console.log('  page:', m.text()))
const cdp = await tab.createCDPSession()
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
})
await tab.setRequestInterception(true)
tab.on('request', (r) => (r.url().startsWith(`${ORIGIN}/`) && r.resourceType() === 'document'
  ? r.respond({ status: 200, contentType: 'text/html', body: page })
  : r.continue()))
await tab.goto(`${ORIGIN}/#key=${encodeURIComponent(key)}`)
await tab.waitForFunction('window.pocReady === true', { timeout: 60_000 })
const result = await tab.evaluate(() => window.poc())
console.log(JSON.stringify(result, null, 2))
await browser.close()
process.exit(result.ok ? 0 : 1)
