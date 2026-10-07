// Deploy MimirV3 (VS) and MimirPool (two-sided) to Arc in native-USDC mode, then print the env lines lib/arc/config.ts reads.
//   forge build && ARC_DEPLOYER_KEY=0x… node scripts/arc/deploy.mjs
// Env (all optional except the key):
//   ARC_NETWORK testnet|mainnet, ARC_RPC (required on mainnet)
//   ARC_ORACLE, ARC_FEE_RECIPIENT  default: the deployer
//   ARC_PLATFORM_FEE_BPS 500, ARC_AGENT_FEE_BPS 0, ARC_POOL_FEE_BPS 500, ARC_DISPUTE_WINDOW 3600 (seconds)
// The deployer becomes owner of both; hand ownership over with transferOwnership + acceptOwnership (timelocked).
// Agent payout wallets are listed later by the owner with setAgentPayout(wallet, true).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const art = async (n) => JSON.parse(await readFile(join(root, `forge-out/${n}.sol/${n}.json`), 'utf8'))
const e = process.env
const key = e.ARC_DEPLOYER_KEY?.trim()
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw new Error('ARC_DEPLOYER_KEY (0x + 64 hex) is required')
const mainnet = e.ARC_NETWORK === 'mainnet'
if (mainnet && !e.ARC_RPC) throw new Error('ARC_RPC is required on mainnet')
const chain = mainnet
  ? { id: 5042, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [e.ARC_RPC] } } }
  : { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [e.ARC_RPC || 'https://rpc.testnet.arc.network'] } } }

const account = privateKeyToAccount(key)
const oracle = getAddress(e.ARC_ORACLE || account.address)
const feeTo = getAddress(e.ARC_FEE_RECIPIENT || account.address)
const num = (v, d) => { const n = Number(v ?? d); if (!Number.isInteger(n) || n < 0) throw new Error(`bad number ${v}`); return n }
const platformBps = num(e.ARC_PLATFORM_FEE_BPS, 500), agentBps = num(e.ARC_AGENT_FEE_BPS, 0), poolBps = num(e.ARC_POOL_FEE_BPS, 500)
const window = BigInt(num(e.ARC_DISPUTE_WINDOW, 3600))

const pub = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({ account, chain, transport: http() })
if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not chain ${chain.id}`)
console.log(`${chain.name}: deployer ${account.address} (${Number(await pub.getBalance({ address: account.address })) / 1e18} USDC), oracle ${oracle}, fees to ${feeTo}`)

const deploy = async (name, args) => {
  const a = await art(name)
  const rc = await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }) })
  if (rc.status !== 'success' || !rc.contractAddress) throw new Error(`${name} deploy failed ${rc.transactionHash}`)
  console.log(`  ${name} ${rc.contractAddress} block ${rc.blockNumber} (${Number(rc.gasUsed * rc.effectiveGasPrice) / 1e18} USDC)`)
  return rc
}
const v3 = await deploy('MimirV3', [oracle, platformBps, agentBps, feeTo, '0x0000000000000000000000000000000000000000', window])
const pool = await deploy('MimirPool', [oracle, poolBps, feeTo, window])

console.log(`\nNEXT_PUBLIC_MIMIR_V3_ADDRESS=${v3.contractAddress}
NEXT_PUBLIC_MIMIR_POOL_ADDRESS=${pool.contractAddress}
NEXT_PUBLIC_MIMIR_ARC_FROM_BLOCK=${v3.blockNumber}`)
