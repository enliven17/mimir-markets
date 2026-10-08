// Deploy MimirFees, then MimirV3 (VS) and MimirPool (two-sided) wired to it, on Arc in native-USDC mode, and print
// the env lines lib/arc/config.ts reads.
//   forge build && ARC_DEPLOYER_KEY=0x… node scripts/arc/deploy.mjs
// Roles (each its own address; set at deploy, nothing is left on the deployer key):
//   ARC_OWNER          admin: pause, caps, veto, revoke the oracle/signer, timelocked changes (a Safe on mainnet)
//   ARC_ARBITER        rules disputed and vetoed proposals (a Safe on mainnet; may be the owner's Safe only with
//                      ARC_ARBITER_IS_OWNER=1)
//   ARC_ORACLE         the settlement hot key; never owner, arbiter or fee recipient (the contracts refuse it)
//   ARC_FEE_RECIPIENT  receives entry fees, the copy-trade platform share and forfeited bonds
//   ARC_FEE_SIGNER     the server key that signs $MIMIR holder fee tickets
// Other env:
//   ARC_NETWORK testnet|mainnet, ARC_RPC (required on mainnet)
//   ARC_DISPUTE_WINDOW seconds; default 86400 on mainnet (the contracts refuse less off testnet), 3600 on testnet
//   ARC_MIN_STAKE 0.1 (USDC; 0.01 to 100, fixed at deploy; the dispute bond stays 2 USDC)
// Mainnet refuses to run unless every role is set, none is the deployer, they do not collide, and the owner and
// arbiter are contracts (the Safe deployed first). Testnet fills missing roles with throwaway-friendly defaults:
// owner and arbiter the deployer, oracle ARC_ORACLE (required: it must differ from the owner), fees to the deployer.
// Fees are fixed in the contracts: 0.5% entry (0.25% / 0.1% with a holder ticket), copy trades 1% + 1% of profit.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const art = async (n) => JSON.parse(await readFile(join(root, `forge-out/${n}.sol/${n}.json`), 'utf8'))
const e = process.env
const key = e.ARC_DEPLOYER_KEY?.trim()
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) throw new Error('ARC_DEPLOYER_KEY (0x + 64 hex) is required')
const mainnet = e.ARC_NETWORK === 'mainnet'
if (mainnet && !e.ARC_RPC) throw new Error('ARC_RPC is required on mainnet')
const TESTNET_ID = 5042002
const chain = mainnet
  ? { id: Number(e.ARC_CHAIN_ID ?? 5042), name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [e.ARC_RPC] } } }
  : { id: TESTNET_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [e.ARC_RPC || 'https://rpc.testnet.arc.network'] } } }

const account = privateKeyToAccount(key)
const role = (name, fallback) => {
  const v = e[name]?.trim()
  if (v) {
    if (!isAddress(v)) throw new Error(`${name} is not an address`)
    return getAddress(v)
  }
  if (mainnet) throw new Error(`${name} is required on mainnet`)
  return fallback
}
const owner = role('ARC_OWNER', account.address)
const arbiter = role('ARC_ARBITER', owner)
const oracle = role('ARC_ORACLE', undefined)
if (!oracle) throw new Error('ARC_ORACLE is required (the oracle key may not be the owner, so it cannot default to the deployer)')
const feeTo = role('ARC_FEE_RECIPIENT', account.address)
const feeSigner = role('ARC_FEE_SIGNER', account.address)

const window = BigInt(e.ARC_DISPUTE_WINDOW ?? (mainnet ? 86400 : 3600))
if (window < 0n || window > 7n * 86400n) throw new Error('ARC_DISPUTE_WINDOW must be 0..604800 seconds')
if (chain.id !== TESTNET_ID && window < 86400n) throw new Error('off testnet the dispute window must be at least 86400 seconds')
const minStake = (e.ARC_MIN_STAKE ?? '0.1').trim()
if (!/^\d+(\.\d{1,6})?$/.test(minStake)) throw new Error('ARC_MIN_STAKE must be USDC like 0.1')

// The oracle is the hot key: the contracts refuse it as owner, arbiter or fee recipient; check here too.
if ([owner, arbiter, feeTo].includes(oracle)) throw new Error('the oracle may not also be the owner, arbiter or fee recipient')

const pub = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({ account, chain, transport: http() })
if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not chain ${chain.id}`)

if (mainnet) {
  const roles = { owner, arbiter, oracle, feeTo, feeSigner }
  for (const [name, a] of Object.entries(roles)) {
    if (a === account.address) throw new Error(`mainnet: ${name} may not be the deployer key`)
  }
  const distinct = [oracle, feeTo, feeSigner, owner]
  if (e.ARC_ARBITER_IS_OWNER !== '1') distinct.push(arbiter)
  else if (arbiter !== owner) throw new Error('ARC_ARBITER_IS_OWNER=1 but the arbiter differs from the owner')
  if (new Set(distinct).size !== distinct.length) throw new Error('mainnet: owner, arbiter, oracle, fee recipient and fee signer must all differ')
  for (const [name, a] of [['owner', owner], ['arbiter', arbiter]]) {
    const code = await pub.getCode({ address: a })
    if (!code || code === '0x') throw new Error(`mainnet: the ${name} ${a} has no code; deploy the Safe first`)
  }
}

console.log(`${chain.name}: deployer ${account.address} (${Number(await pub.getBalance({ address: account.address })) / 1e18} USDC)
  owner ${owner}  arbiter ${arbiter}  oracle ${oracle}  fees to ${feeTo}  fee signer ${feeSigner}  window ${window}s`)

const deploy = async (name, args) => {
  const a = await art(name)
  const rc = await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }) })
  if (rc.status !== 'success' || !rc.contractAddress) throw new Error(`${name} deploy failed ${rc.transactionHash}`)
  console.log(`  ${name} ${rc.contractAddress} block ${rc.blockNumber} (${Number(rc.gasUsed * rc.effectiveGasPrice) / 1e18} USDC)`)
  return rc
}
const fees = await deploy('MimirFees', [owner, feeSigner])
const v3 = await deploy('MimirV3', [owner, arbiter, oracle, feeTo, fees.contractAddress, window, parseEther(minStake)])
const pool = await deploy('MimirPool', [owner, arbiter, oracle, feeTo, fees.contractAddress, window, parseEther(minStake)])

console.log(`\nNEXT_PUBLIC_MIMIR_FEES_ADDRESS=${fees.contractAddress}
NEXT_PUBLIC_MIMIR_V3_ADDRESS=${v3.contractAddress}
NEXT_PUBLIC_MIMIR_POOL_ADDRESS=${pool.contractAddress}
NEXT_PUBLIC_MIMIR_ARC_FROM_BLOCK=${v3.blockNumber}
NEXT_PUBLIC_MIMIR_MIN_STAKE=${minStake}`)
