// Run one call through a Safe (v1.4.1): build the Safe transaction, sign it with the given owner keys (EIP-712), and
// submit execTransaction from a payer. For owner actions on Mimir (pause, caps, veto, revokeOracle, timelocked queues).
//
//   SAFE=0x… TO=0x… DATA=0x… [VALUE=0] SIGNER_KEYS=0xk1,0xk2 PAYER_KEY=0x… [ARC_RPC=…] node scripts/arc/safe-exec.mjs
//   or with a function instead of raw data:  FN='setCaps(uint256,uint256)' ARGS='[500e18,50e18]' (numbers as strings)
//
// The signatures are sorted by owner address as the Safe requires. Fewer signatures than the threshold are refused
// by the Safe itself (GS020); --check-only prints the Safe tx hash and the signers without sending.
import { concat, createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, parseAbi, parseAbiItem, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const e = process.env
const rpc = (e.ARC_RPC ?? 'https://rpc.testnet.arc.network').split(',')[0].trim()
const safe = getAddress(e.SAFE)
const to = getAddress(e.TO)
const value = BigInt(e.VALUE ?? '0')
let data = e.DATA ?? '0x'
if (e.FN) {
  const item = parseAbiItem(`function ${e.FN}`)
  const args = JSON.parse(e.ARGS ?? '[]').map((a) => (typeof a === 'string' && /^\d/.test(a) ? BigInt(Number(a).toLocaleString('fullwide', { useGrouping: false })) : a))
  data = encodeFunctionData({ abi: [item], functionName: item.name, args })
}
const signers = (e.SIGNER_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean).map((k) => privateKeyToAccount(k))
if (!signers.length) throw new Error('SIGNER_KEYS: at least one owner key')

const pub = createPublicClient({ transport: http(rpc) })
const chainId = await pub.getChainId()
const chain = { id: chainId, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }
const abi = parseAbi([
  'function nonce() view returns (uint256)',
  'function getThreshold() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)',
])
const [nonce, threshold, owners] = await Promise.all(['nonce', 'getThreshold', 'getOwners'].map((f) => pub.readContract({ address: safe, abi, functionName: f })))
for (const s of signers) if (!owners.includes(s.address)) throw new Error(`${s.address} is not an owner of ${safe}`)

const tx = { to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress, nonce }
const typed = {
  domain: { chainId, verifyingContract: safe },
  types: {
    SafeTx: [
      { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
    ],
  },
  primaryType: 'SafeTx',
  message: tx,
}
const sigs = await Promise.all(signers.map(async (s) => ({ owner: s.address, sig: await s.signTypedData(typed) })))
sigs.sort((a, b) => (BigInt(a.owner) < BigInt(b.owner) ? -1 : 1))
const signatures = concat(sigs.map((x) => x.sig))
console.log(`safe ${safe} nonce ${nonce} threshold ${threshold}; ${sigs.length} signature(s) from ${sigs.map((x) => x.owner).join(', ')}`)
if (process.argv.includes('--check-only')) process.exit(0)

const payer = createWalletClient({ account: privateKeyToAccount(e.PAYER_KEY), chain, transport: http(rpc) })
const args = [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures]
// Simulate first: a short signature set fails here (GS020) without spending gas.
await pub.simulateContract({ address: safe, abi, functionName: 'execTransaction', args, account: payer.account })
const hash = await payer.writeContract({ address: safe, abi, functionName: 'execTransaction', args })
const rc = await pub.waitForTransactionReceipt({ hash, pollingInterval: 2000 })
if (rc.status !== 'success') throw new Error(`execTransaction reverted: ${hash}`)
console.log(`executed ${hash}`)
