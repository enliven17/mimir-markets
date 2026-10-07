// Step 4 of the Arc POC: this branch's contracts (contracts/, after the review fixes) on Arc testnet, played by
// passkey smart accounts funded from Solana devnet over CCTP.
//   MimirV3 (VS): X opens a claim, Y challenges, the oracle says challengers win, Y is paid.
//   MimirPool (two-sided): Y opens a market on side B, X stakes side A, A wins, the app pushes X's payout with
//   claimFor, and Y (the loser) has nothing to claim.
// The deployer/oracle is the throwaway EOA from run-mimir.mjs ($TEMP/mimir-arc-poc-oracle.key).
//   forge build && node scripts/arc-poc/run-contracts.mjs
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { burnToArc, waitForAttestation } from './cctp-solana.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const art = async (n) => JSON.parse(await readFile(join(root, `forge-out/${n}.sol/${n}.json`), 'utf8'))
const V3 = await art('MimirV3'), POOL = await art('MimirPool')
const env = await readFile(join(root, '.env.local'), 'utf8').catch(() => '')
const key = /^CIRCLE_CLIENT_KEY=(.+)$/m.exec(env)?.[1]?.trim()
const page = await readFile(fileURLToPath(new URL('./page.html', import.meta.url)), 'utf8')
const eoa = privateKeyToAccount((await readFile(join(process.env.TEMP ?? '.', 'mimir-arc-poc-oracle.key'), 'utf8')).trim())
const ORIGIN = 'https://mimirmarkets.xyz'

const arcTestnet = { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } }
const arc = createPublicClient({ chain: arcTestnet, transport: http() })
const wallet = createWalletClient({ account: eoa, chain: arcTestnet, transport: http() })
const MT = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const ZERO = '0x0000000000000000000000000000000000000000'
const receiveAbi = [{ type: 'function', name: 'receiveMessage', stateMutability: 'nonpayable', inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }], outputs: [{ type: 'bool' }] }]
const usd = (wei) => (Number(wei) / 1e18).toFixed(4)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (s) => console.log(`\n── ${s}`)
const two = 2n * 10n ** 18n

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
const eoaTx = async (args) => { const h = await wallet.writeContract(args); const rc = await arc.waitForTransactionReceipt({ hash: h }); if (rc.status !== 'success') await fail(`${args.functionName} reverted ${h}`); return h }

const resume = process.argv.length >= 5 ? { v3: process.argv[2], pool: process.argv[3], v3Winner: process.argv[4] } : null
try {
  step(`two passkey accounts, funded from Solana devnet over CCTP (${resume ? 'X 2.2, Y 2.2' : 'X 4.2, Y 3'} USDC)`)
  const X = await tab.evaluate(() => window.createNamed('x'))
  const Y = await tab.evaluate(() => window.createNamed('y'))
  const sigs = []
  for (const [to, amount] of resume ? [[X, 2_200_000n], [Y, 2_200_000n]] : [[X, 4_200_000n], [Y, 3_000_000n]]) sigs.push((await burnToArc({ keypairPath: join(homedir(), '.config/solana/talos-deploy.json'), amount, recipient: to })).sig)
  const atts = []
  for (const s of sigs) atts.push(await waitForAttestation(s))
  await send('x', atts.map((a) => ({ to: MT, data: encodeFunctionData({ abi: receiveAbi, functionName: 'receiveMessage', args: [a.message, a.attestation] }) })))
  console.log(`  X ${usd(await arc.getBalance({ address: X }))}  Y ${usd(await arc.getBalance({ address: Y }))}  oracle ${usd(await arc.getBalance({ address: eoa.address }))} USDC`)

  let v3, pool, vid, deadline, yV3
  if (resume) {
    ;({ v3, pool } = resume); vid = 1n; yV3 = resume.v3Winner
    console.log(`  reusing MimirV3 ${v3} (claim 1 open) and MimirPool ${pool}`)
    deadline = BigInt(Number((await arc.getBlock()).timestamp) + 130)
  } else {
  step('deploy MimirV3 and MimirPool (60 s dispute window, 5% fee to the oracle EOA)')
  const dv = await arc.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: V3.abi, bytecode: V3.bytecode.object, args: [eoa.address, 500, 0, eoa.address, ZERO, 60n] }) })
  const dp = await arc.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: POOL.abi, bytecode: POOL.bytecode.object, args: [eoa.address, 500, eoa.address, 60n] }) })
  v3 = dv.contractAddress; pool = dp.contractAddress; yV3 = Y
  console.log(`  MimirV3 ${v3} (${usd(dv.gasUsed * dv.effectiveGasPrice)} USDC)  MimirPool ${pool} (${usd(dp.gasUsed * dp.effectiveGasPrice)} USDC)`)

  step('open both markets')
  deadline = BigInt(Number((await arc.getBlock()).timestamp) + 130)
  await send('x', [{ to: v3, value: two.toString(), data: encodeFunctionData({ abi: V3.abi, functionName: 'createClaim', args: ['POC v3', 'yes', 'no', 'https://example.com', deadline, two, 'custom', 0n, 'binary', 'pool', 0n, '', 'test', 5n, false, '', ZERO] }) }])
  vid = await arc.readContract({ address: v3, abi: V3.abi, functionName: 'claimCount' })
  await send('y', [{ to: v3, value: two.toString(), data: encodeFunctionData({ abi: V3.abi, functionName: 'challengeClaim', args: [vid, two, '', ZERO] }) }])
  console.log('  V3 claim', vid.toString(), 'created by X, challenged by Y')
  }
  await send('y', [{ to: pool, value: two.toString(), data: encodeFunctionData({ abi: POOL.abi, functionName: 'createMarket', args: ['POC pool', 'A', 'B', 'https://example.com', 'custom', deadline, 2] }) }])
  const pid = 1n
  await send('x', [{ to: pool, value: two.toString(), data: encodeFunctionData({ abi: POOL.abi, functionName: 'stake', args: [pid, 1] }) }])
  console.log('  Pool market', pid.toString(), 'Y on B, X on A; totals', (await arc.readContract({ address: pool, abi: POOL.abi, functionName: 'sideTotals', args: [pid] })).map(usd).join(' / '))

  step('deadline, the oracle proposes: V3 challengers win, Pool side A wins')
  while (Number((await arc.getBlock()).timestamp) < Number(deadline) + 2) await sleep(5000)
  await eoaTx({ address: v3, abi: V3.abi, functionName: 'resolveClaim', args: [vid, 2, 'POC', 90, keccak256(toHex('e'))] })
  await eoaTx({ address: pool, abi: POOL.abi, functionName: 'resolve', args: [pid, 1, 'POC', keccak256(toHex('e'))] })

  step('dispute window, finalize, pay')
  await sleep(65_000)
  const yBefore = await arc.getBalance({ address: yV3 }), xBefore = await arc.getBalance({ address: X })
  await eoaTx({ address: v3, abi: V3.abi, functionName: 'finalizeResolution', args: [vid], gas: 2_000_000n })
  console.log(`  V3: challenger (winner) +${usd((await arc.getBalance({ address: yV3 })) - yBefore)} USDC, parked ${usd(await arc.readContract({ address: v3, abi: V3.abi, functionName: 'pendingWithdrawals', args: [yV3] }))}`)
  await eoaTx({ address: pool, abi: POOL.abi, functionName: 'finalize', args: [pid] })
  const [xNet] = await arc.readContract({ address: pool, abi: POOL.abi, functionName: 'claimable', args: [pid, X] })
  console.log(`  Pool: claimable X ${usd(xNet)}`)
  await eoaTx({ address: pool, abi: POOL.abi, functionName: 'claimFor', args: [pid, X], gas: 500_000n })
  console.log(`  Pool: X (side A, winner) +${usd((await arc.getBalance({ address: X })) - xBefore)} USDC via claimFor`)
  const loser = await arc.simulateContract({ account: eoa, address: pool, abi: POOL.abi, functionName: 'claimFor', args: [pid, Y] }).then(() => 'paid?!', (e) => e.shortMessage ?? e.message)
  console.log(`  Pool: claimFor(Y, loser) → ${loser.split('\n')[0]}`)
  console.log(`  fees accrued: V3 ${usd(await arc.readContract({ address: v3, abi: V3.abi, functionName: 'accruedFees', args: [eoa.address] }))}, Pool ${usd(await arc.readContract({ address: pool, abi: POOL.abi, functionName: 'accruedFees', args: [eoa.address] }))}`)
  await browser.close()
  process.exit(0)
} catch (e) {
  await fail(e?.shortMessage ?? e?.message ?? e)
}
