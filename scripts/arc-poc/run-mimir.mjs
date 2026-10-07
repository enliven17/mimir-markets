// Step 3 of the Arc POC: MimirV3 with passkey smart accounts as the players.
//   1. two passkey accounts (creator, challenger) and a throwaway EOA as deployer, owner and oracle
//   2. fund all three from Solana devnet over CCTP (the creator's account receives every message, gasless)
//   3. deploy MimirV3 in native-USDC mode with a 60 s dispute window and a 5% platform fee
//   4. the creator account opens a claim, the challenger account challenges it (both gasless, stake as msg.value)
//   5. the oracle proposes "challengers win", the window passes, anyone finalizes
//   6. does the 50k-gas payout push reach a smart account, or is it parked in pendingWithdrawals? recover if parked
// Needs the compiled artifact: forge build in ../mimir with --out <dir>; pass <dir>/MimirV3.sol/MimirV3.json.
//   node run-mimir.mjs <path to MimirV3.json>
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { burnToArc, waitForAttestation } from './cctp-solana.mjs'

const artifact = JSON.parse(await readFile(process.argv[2], 'utf8'))
const abi = artifact.abi, bytecode = artifact.bytecode.object
const env = await readFile(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8').catch(() => '')
const key = /^CIRCLE_CLIENT_KEY=(.+)$/m.exec(env)?.[1]?.trim()
const page = await readFile(fileURLToPath(new URL('./page.html', import.meta.url)), 'utf8')
const ORIGIN = 'https://mimirmarkets.xyz'
const solKey = join(homedir(), '.config/solana/talos-deploy.json')

const arcTestnet = { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } }
const arc = createPublicClient({ chain: arcTestnet, transport: http() })
const MT = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const receiveAbi = [{ type: 'function', name: 'receiveMessage', stateMutability: 'nonpayable', inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }], outputs: [{ type: 'bool' }] }]
const usd = (wei) => (Number(wei) / 1e18).toFixed(4)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (s) => console.log(`\n── ${s}`)

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const fail = async (msg) => { console.error('FAILED', msg); await browser.close(); process.exit(1) }
const tab = await browser.newPage()
tab.on('console', (m) => { if (!/Failed to load resource|pubKeyCredParams/.test(m.text())) console.log('  page:', m.text()) })
const cdp = await tab.createCDPSession()
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
await tab.setRequestInterception(true)
tab.on('request', (r) => (r.url().startsWith(`${ORIGIN}/`) && r.resourceType() === 'document' ? r.respond({ status: 200, contentType: 'text/html', body: page }) : r.continue()))
await tab.goto(`${ORIGIN}/#key=${encodeURIComponent(key)}`)
await tab.waitForFunction('window.pocReady === true', { timeout: 60_000 })
const send = async (name, calls) => {
  const r = await tab.evaluate((n, c) => window.sendCalls(n, c), name, calls)
  if (!r.ok) await fail(`${name}: ${r.error ?? r.reason ?? 'reverted'} ${r.tx ?? ''}`)
  return r
}

try {
  step('accounts')
  const creator = await tab.evaluate(() => window.createNamed('creator'))
  const challenger = await tab.evaluate(() => window.createNamed('challenger'))
  const pk = generatePrivateKey(), eoa = privateKeyToAccount(pk)
  await writeFile(join(process.env.TEMP ?? '.', 'mimir-arc-poc-oracle.key'), pk) // testnet throwaway, outside the repo
  console.log('oracle/owner EOA', eoa.address)

  step('fund over CCTP from Solana devnet: 3 + 3 + 1 USDC')
  const burns = []
  for (const [to, amount] of [[creator, 3_000_000n], [challenger, 3_000_000n], [eoa.address, 1_000_000n]]) {
    const b = await burnToArc({ keypairPath: solKey, amount, recipient: to })
    console.log('  burn', to.slice(0, 10), b.sig.slice(0, 16))
    burns.push(b.sig)
  }
  const atts = []
  for (const sig of burns) atts.push(await waitForAttestation(sig))
  const recv = await send('creator', atts.map((a) => ({ to: MT, data: encodeFunctionData({ abi: receiveAbi, functionName: 'receiveMessage', args: [a.message, a.attestation] }) })))
  console.log('  received all three in one sponsored op', recv.tx)
  for (const [n, a] of [['creator', creator], ['challenger', challenger], ['oracle', eoa.address]]) console.log(`  ${n} ${usd(await arc.getBalance({ address: a }))} USDC`)

  step('deploy MimirV3 (native USDC, 60 s dispute window, 5% platform fee to the oracle EOA)')
  const wallet = createWalletClient({ account: eoa, chain: arcTestnet, transport: http() })
  const deployHash = await wallet.deployContract({ abi, bytecode, args: [eoa.address, 500, 0, eoa.address, '0x0000000000000000000000000000000000000000', 60n] })
  const dep = await arc.waitForTransactionReceipt({ hash: deployHash })
  const mimir = dep.contractAddress
  console.log('  MimirV3', mimir, 'gas', dep.gasUsed.toString(), 'cost', usd(dep.gasUsed * dep.effectiveGasPrice), 'USDC')

  step('creator account opens a claim (2 USDC), challenger account challenges (2 USDC)')
  const now = Number((await arc.getBlock()).timestamp)
  const deadline = BigInt(now + 120)
  const stake = 2n * 10n ** 18n
  const create = await send('creator', [{ to: mimir, value: stake.toString(), data: encodeFunctionData({ abi, functionName: 'createClaim', args: [
    'POC: will this test pass?', 'yes', 'no', 'https://example.com', deadline, stake, 'custom', 0n, 'binary', 'pool', 0n, '', 'test', 2n, false, '', '0x0000000000000000000000000000000000000000',
  ] }) }])
  const id = await arc.readContract({ address: mimir, abi, functionName: 'claimCount' })
  console.log('  claim', id.toString(), create.tx)
  const ch = await send('challenger', [{ to: mimir, value: stake.toString(), data: encodeFunctionData({ abi, functionName: 'challengeClaim', args: [id, stake, '', '0x0000000000000000000000000000000000000000'] }) }])
  console.log('  challenged', ch.tx)

  step('wait for the deadline, the oracle proposes "challengers win"')
  while (Number((await arc.getBlock()).timestamp) < Number(deadline) + 2) await sleep(5000)
  const res = await wallet.writeContract({ address: mimir, abi, functionName: 'resolveClaim', args: [id, 2, 'POC verdict', 90, keccak256(toHex('evidence'))] })
  await arc.waitForTransactionReceipt({ hash: res })
  console.log('  proposed', res)

  step('wait out the 60 s dispute window, finalize')
  await sleep(65_000)
  const before = { creator: await arc.getBalance({ address: creator }), challenger: await arc.getBalance({ address: challenger }) }
  const fin = await wallet.writeContract({ address: mimir, abi, functionName: 'finalizeResolution', args: [id], gas: 2_000_000n })
  const finRc = await arc.waitForTransactionReceipt({ hash: fin })
  console.log('  finalized', fin, finRc.status)

  step('where did the money go?')
  const pend = await arc.readContract({ address: mimir, abi, functionName: 'pendingWithdrawals', args: [challenger] })
  const after = await arc.getBalance({ address: challenger })
  console.log(`  challenger pushed ${usd(after - before.challenger)} USDC, parked ${usd(pend)} USDC`)
  console.log(`  platform fee accrued ${usd(await arc.readContract({ address: mimir, abi, functionName: 'accruedFees', args: [eoa.address] }))} USDC`)
  if (pend > 0n) {
    step('parked: the challenger account pulls it with withdraw() (gasless)')
    const w = await send('challenger', [{ to: mimir, data: encodeFunctionData({ abi, functionName: 'withdraw', args: [] }) }])
    console.log('  withdraw', w.tx, `balance now ${usd(await arc.getBalance({ address: challenger }))} USDC`)
  }
  console.log(`\nfinal: creator ${usd(await arc.getBalance({ address: creator }))}, challenger ${usd(await arc.getBalance({ address: challenger }))} USDC`)
  await browser.close()
  process.exit(0)
} catch (e) {
  await fail(e?.shortMessage ?? e?.message ?? e)
}
