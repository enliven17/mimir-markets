// The contracts' `oracle` role, for the deploy scripts (scripts/base/deploy-markets.mts, scripts/arc/deploy.mjs): ONE
// address on every chain, the one ORACLE_KEY signs with (lib/chains/house.ts oracleKey: ORACLE_KEY, ARC_ORACLE_KEY as a
// deprecated alias; BASE_ORACLE_KEY is no longer read). Tests: tests/node/oracle-key.test.ts.
import { createPublicClient, getAddress, http, isAddress, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

/**
 * The oracle address to deploy with. `roleVar` is the chain's own name for it (BASE_ORACLE / ARC_ORACLE); ORACLE_ADDRESS
 * is the shared one. With ORACLE_KEY in the env as well, the named address must be that key's: a deploy that would
 * give one chain a different oracle than the backend signs with is refused.
 * @param {Record<string, string | undefined>} env
 * @param {string} roleVar
 * @returns {{ address: `0x${string}`, source: string, warnings: string[] }}
 */
export function oracleRole(env, roleVar) {
  const warnings = []
  const main = env.ORACLE_KEY?.trim()
  const alias = env.ARC_ORACLE_KEY?.trim()
  if (!main && alias) warnings.push('ARC_ORACLE_KEY is deprecated: rename it to ORACLE_KEY')
  if (env.BASE_ORACLE_KEY?.trim()) warnings.push('BASE_ORACLE_KEY is ignored: one ORACLE_KEY signs on every chain')
  const raw = main || alias || ''
  let fromKey = null
  if (raw) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('ORACLE_KEY must be 0x + 64 hex')
    fromKey = privateKeyToAccount(/** @type {`0x${string}`} */ (raw)).address
  }
  const namedVar = env[roleVar]?.trim() ? roleVar : env.ORACLE_ADDRESS?.trim() ? 'ORACLE_ADDRESS' : null
  let named = null
  if (namedVar) {
    const v = /** @type {string} */ (env[namedVar]).trim()
    if (!isAddress(v, { strict: false })) throw new Error(`${namedVar} is not an address`)
    named = getAddress(v)
  }
  if (fromKey && named && fromKey !== named) {
    throw new Error(`${namedVar} ${named} is not ORACLE_KEY's address ${fromKey}: the oracle must be the same address on every chain`)
  }
  const address = named ?? fromKey
  if (!address) throw new Error(`the oracle is required: set ORACLE_ADDRESS (or ${roleVar}), the address of the ORACLE_KEY the backend signs with on every chain`)
  return { address, source: namedVar ?? 'ORACLE_KEY', warnings }
}

const ROLE_ABI = parseAbi(['function oracle() view returns (address)', 'function pendingOracle() view returns (address)'])

/**
 * The oracle (and the one queued behind the timelock) of a market contract already deployed on another chain; null
 * when it cannot be read (no RPC, nothing there).
 * @param {{ rpc: string, contract: string }} where
 */
export async function deployedOracle({ rpc, contract }) {
  try {
    const pub = createPublicClient({ transport: http(rpc) })
    const address = getAddress(contract)
    const [oracle, pending] = await Promise.all([
      pub.readContract({ address, abi: ROLE_ABI, functionName: 'oracle' }),
      pub.readContract({ address, abi: ROLE_ABI, functionName: 'pendingOracle' }).catch(() => '0x0000000000000000000000000000000000000000'),
    ])
    return { oracle: getAddress(oracle), pending: getAddress(pending) }
  } catch {
    return null
  }
}

/**
 * Refuse a deploy whose oracle differs from the other chain's (unless the other chain is moving to it: pendingOracle).
 * @param {`0x${string}`} address
 * @param {{ oracle: string, pending: string } | null} other
 * @param {string} label the other chain's name, for the message
 * @returns {string} what to print
 */
export function sameOracleAs(address, other, label) {
  if (!other) return `${label}: not checked (set its RPC and pool address to compare)`
  if (other.oracle === address) return `${label}: same oracle ${address}`
  if (other.pending === address) return `${label}: oracle ${other.oracle}, moving to ${address} (pending timelock)`
  throw new Error(`${label}'s contracts use oracle ${other.oracle}, not ${address}: one oracle key signs on every chain (queueOracle on ${label}, or deploy with its address)`)
}
