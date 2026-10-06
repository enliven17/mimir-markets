// Step 2 of the Arc POC: Solana devnet USDC → CCTP V2 (fast) → a passkey smart account on Arc testnet, received with a
// gas-sponsored user operation. Then reads the account's USDC as the native balance (18 decimals) and through the
// ERC-20 interface (6 decimals). Uses the devnet keypair at ~/.config/solana/talos-deploy.json (devnet USDC only).
//   cd scripts/arc-poc && node run-cctp.mjs [amountUsdc=1]
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createPublicClient, erc20Abi, http } from 'viem'
import { burnToArc, receiveOnSolana, solanaMintRecipient, solanaUsdc, waitForArcAttestation, waitForAttestation } from './cctp-solana.mjs'

const amountUsdc = Number(process.argv[2] ?? 1)
const env = await readFile(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8').catch(() => '')
const key = /^CIRCLE_CLIENT_KEY=(.+)$/m.exec(env)?.[1]?.trim()
if (!key) throw new Error('add CIRCLE_CLIENT_KEY to .env.local')
const page = await readFile(fileURLToPath(new URL('./page.html', import.meta.url)), 'utf8')
const ORIGIN = 'https://mimirmarkets.xyz' // must equal the Console's allowed domain exactly

const arc = createPublicClient({ transport: http('https://rpc.testnet.arc.network') })
const balances = async (address) => ({
  native: (await arc.getBalance({ address })).toString(),
  erc20: (await arc.readContract({ address: '0x3600000000000000000000000000000000000000', abi: erc20Abi, functionName: 'balanceOf', args: [address] })).toString(),
})

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const tab = await browser.newPage()
tab.on('console', (m) => { if (!/Failed to load resource|pubKeyCredParams/.test(m.text())) console.log('  page:', m.text()) })
const cdp = await tab.createCDPSession()
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
await tab.setRequestInterception(true)
tab.on('request', (r) => (r.url().startsWith(`${ORIGIN}/`) && r.resourceType() === 'document' ? r.respond({ status: 200, contentType: 'text/html', body: page }) : r.continue()))
await tab.goto(`${ORIGIN}/#key=${encodeURIComponent(key)}`)
await tab.waitForFunction('window.pocReady === true', { timeout: 60_000 })

try {
  const account = await tab.evaluate(() => window.createAccount())
  console.log('before', await balances(account))

  const t0 = Date.now()
  const burn = await burnToArc({ keypairPath: join(homedir(), '.config/solana/talos-deploy.json'), amount: BigInt(Math.round(amountUsdc * 1e6)), recipient: account })
  console.log('solana burn', burn.sig, 'maxFee', burn.maxFee.toString())
  const att = await waitForAttestation(burn.sig)
  console.log(`attested in ${Math.round((Date.now() - t0) / 1000)}s`)
  const rec = await tab.evaluate((m, a) => window.receive(m, a), att.message, att.attestation)
  console.log('receive', JSON.stringify(rec))
  console.log('after', await balances(account), `total ${Math.round((Date.now() - t0) / 1000)}s`)
  if (!rec.ok) throw new Error('receive on arc failed')

  // the way back: half of it to the same devnet wallet's USDC account
  const keypairPath = join(homedir(), '.config/solana/talos-deploy.json')
  const to = solanaMintRecipient(burn.from)
  const solBefore = await solanaUsdc(to.ata)
  const t1 = Date.now()
  const back = await tab.evaluate((a, r) => window.withdrawToSolana(a, r), String(Math.round((amountUsdc * 1e6) / 2)), to.bytes32)
  console.log('arc burn', JSON.stringify(back))
  if (!back.ok) throw new Error('burn on arc failed')
  const att2 = await waitForArcAttestation(back.tx)
  console.log(`attested in ${Math.round((Date.now() - t1) / 1000)}s`)
  const solSig = await receiveOnSolana({ keypairPath, message: att2.message, attestation: att2.attestation, recipientAta: to.ata })
  console.log('solana mint', solSig)
  console.log('arc after', await balances(account), 'solana USDC', `${solBefore} -> ${await solanaUsdc(to.ata)}`, `back in ${Math.round((Date.now() - t1) / 1000)}s`)
  await browser.close()
  process.exit(0)
} catch (e) {
  console.error('FAILED', e?.message ?? e)
  await browser.close()
  process.exit(1)
}
