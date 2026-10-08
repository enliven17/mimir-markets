// Create a Safe v1.4.1 multisig on Arc from the canonical deployments (SafeL2 + SafeProxyFactory + the
// CompatibilityFallbackHandler), for the owner / arbiter / treasury roles (docs/ARC.md, MAINNET-TODO.md).
//
//   SAFE_OWNERS=0xA,0xB,0xC SAFE_THRESHOLD=2 PAYER_KEY=0x… [ARC_RPC=…] [SAFE_SALT=0] node scripts/arc/create-safe.mjs
//
// PAYER_KEY only pays the gas; it gets no role. The Safe's address is deterministic for (owners, threshold, salt):
// the script prints it, deploys it if it is not there yet, and checks getOwners/getThreshold on chain.
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, parseAbi, parseEventLogs, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SINGLETON = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762' // SafeL2 1.4.1
const FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' // SafeProxyFactory 1.4.1
const FALLBACK = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99' // CompatibilityFallbackHandler 1.4.1

const rpc = (process.env.ARC_RPC ?? 'https://rpc.testnet.arc.network').split(',')[0].trim()
const owners = (process.env.SAFE_OWNERS ?? '').split(',').map((a) => a.trim()).filter(Boolean).map((a) => getAddress(a))
const threshold = BigInt(process.env.SAFE_THRESHOLD ?? '2')
const salt = BigInt(process.env.SAFE_SALT ?? '0')
if (owners.length < 2 || new Set(owners).size !== owners.length) throw new Error('SAFE_OWNERS: at least two distinct addresses')
if (threshold < 2n || threshold > BigInt(owners.length)) throw new Error('SAFE_THRESHOLD: between 2 and the number of owners')
if (!process.env.PAYER_KEY) throw new Error('PAYER_KEY is required (pays the gas only)')

const pub = createPublicClient({ transport: http(rpc) })
const chainId = await pub.getChainId()
const chain = { id: chainId, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }
const payer = createWalletClient({ account: privateKeyToAccount(process.env.PAYER_KEY), chain, transport: http(rpc) })

for (const [name, a] of [['SafeL2', SINGLETON], ['SafeProxyFactory', FACTORY], ['FallbackHandler', FALLBACK]]) {
  if (((await pub.getCode({ address: a })) ?? '0x') === '0x') throw new Error(`${name} 1.4.1 is not deployed on chain ${chainId}`)
}

const safeAbi = parseAbi([
  'function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
])
const factoryAbi = parseAbi([
  'function createProxyWithNonce(address _singleton,bytes initializer,uint256 saltNonce) returns (address proxy)',
  'event ProxyCreation(address indexed proxy, address singleton)',
])
const initializer = encodeFunctionData({
  abi: safeAbi,
  functionName: 'setup',
  args: [owners, threshold, zeroAddress, '0x', FALLBACK, zeroAddress, 0n, zeroAddress],
})

// The factory's CREATE2 address, found by simulating the call.
const { result: predicted } = await pub.simulateContract({
  address: FACTORY, abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SINGLETON, initializer, salt], account: payer.account,
}).catch(() => ({ result: null }))

let safe = predicted
if (!predicted || ((await pub.getCode({ address: predicted })) ?? '0x') === '0x') {
  const hash = await payer.writeContract({ address: FACTORY, abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SINGLETON, initializer, salt] })
  const rc = await pub.waitForTransactionReceipt({ hash, pollingInterval: 2000 })
  if (rc.status !== 'success') throw new Error(`Safe creation reverted: ${hash}`)
  safe = parseEventLogs({ abi: factoryAbi, logs: rc.logs, eventName: 'ProxyCreation' })[0].args.proxy
  console.log(`created ${safe} in ${hash}`)
} else console.log(`already deployed: ${safe}`)

const onChainOwners = await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getOwners' })
const onChainThreshold = await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getThreshold' })
const sameOwners = onChainOwners.length === owners.length && owners.every((o) => onChainOwners.includes(o))
if (!sameOwners || onChainThreshold !== threshold) throw new Error('the Safe on chain does not match the owners/threshold asked for')
console.log(JSON.stringify({ safe, chainId, owners: onChainOwners, threshold: Number(onChainThreshold) }))
