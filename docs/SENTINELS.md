# Sentinels

Reference for disputing oracle proposals as a third party on BNB Smart Chain, and for the Sentinel agent that
automates the checks. Audience: Agent ID holders and agent developers. Sources of truth:
[`contracts/MimirV3Erc20.sol`](../contracts/MimirV3Erc20.sol), [`contracts/MimirPoolErc20.sol`](../contracts/MimirPoolErc20.sol)
(`_isSentinel`, `_dispute`), [`contracts/MimirBscFees.sol`](../contracts/MimirBscFees.sol),
[`agents/sentinel/`](../agents/sentinel/).

## What a Sentinel is

A **Sentinel** is any wallet that holds a **Binance Agent ID**: the soulbound SPACE ID `.ai` ERC-721 on BNB Smart
Chain at `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` (mainnet). On BSC a Sentinel can dispute any oracle proposal
without holding a position in the market. Without an Agent ID, only the market's creator and participants can
dispute.

The same Agent ID also gives a **0% entry fee** on every stake.

## How the contract decides

```
dispute(id) ──▶ market contract._isSentinel(msg.sender)
                    └─ staticcall fees.hasAgentId(account)        gas cap 100,000; false on revert or bad return
                           └─ agentIdRegistry.balanceOf(account) > 0   gas cap 50,000; false on revert
```

| Property | Value |
|---|---|
| Registry address | Immutable in `MimirBscFees`, set at deploy. Zero disables the feature (`hasAgentId` returns false). |
| Failure mode | Fails closed. Any error means "not a Sentinel"; it can never block a dispute by a participant, a stake or a settlement. |
| Other chains | Base and Arc fee contracts have no `hasAgentId`, so the call fails and only participants dispute. |
| When checked | At dispute time. Losing the Agent ID later does not undo a dispute already filed. |

## Who may dispute

A dispute is accepted inside the dispute window from any one of these:

| Caller | VS (`disputeResolution`) | Pool (`dispute`, `disputeWithPermit`) |
|---|---|---|
| Market creator | yes | yes (the creator always holds a stake) |
| Participant | challenger | any staker on either side |
| Sentinel (Agent ID, BSC) | yes | yes |
| Audit agent (owner-appointed, optional) | yes | yes |
| Arbiter | yes | yes |

Every caller posts the bond. The owner can also send a proposal to the arbiter with `vetoProposal`, without a bond.
`disputeWithPermit` needs an EIP-2612 permit, which BSC's USDC does not support. On BSC, approve first, then call
`dispute`.

## The bond

| Item | Value |
|---|---|
| Amount | `DISPUTE_BOND` = 2 USDC (2e18 units on BSC, where USDC has 18 decimals) |
| Pulled | With `transferFrom` at dispute time; approve the market contract for exactly the bond first. No entry fee. |
| Returned | When the arbiter's ruling changes the proposed side or the settlement cutoff (`disputerRight`). |
| Forfeited | To the fee recipient when the ruling keeps the proposal, or when nobody rules within the 7-day grace (the proposal then stands). |
| Returned anyway | When the contract is paused past the grace: the market refunds and the bond goes back. |

A dispute stops finalization. Only the arbiter's ruling or `refundExpired` after the grace can settle the market.
One dispute per proposal: once the market is disputed, further disputes revert.

## The Sentinel agent

`agents/sentinel/run.ts` scans recent `ResolutionProposed` events on both BSC contracts, keeps those still inside
their window, and audits each one with `auditProposal` from `agents/sentinel/check.ts`. It uses no model; every check
is deterministic.

| # | Check | Fault when |
|---|---|---|
| 1 | Root re-hash | The published bundle does not re-hash to the on-chain `evidenceHash` (`bundleHash`, see [PROOF-OF-REASONING.md](PROOF-OF-REASONING.md)). |
| 2 | Content receipt | `sha256(evidence.text)` differs from `evidence.sha256`. |
| 3 | Spec vs chain | The bundle's `claim.question`, `resolutionUrl` or `deadline` differs from the market read from the contract. |
| 4 | Judge vs proposal | `finalVerdict.verdict` is not the side proposed on chain. |
| 5 | Deadline prices | For a price claim with a side proposed: two or more independently fetched deadline prices point to the other side. |
| — | Missing bundle | No bundle is published for the committed hash. |

The claim is always read from the contract (`getClaim`, `getMarket`, `getMarketText`), never from Mimir's server.
The bundle comes from `GET /api/markets/{vs|pool}/{id}?chain=bsc` and counts only if its `evidenceHash` equals the
on-chain one.

### Run it

```bash
SENTINEL_PRIVATE_KEY=0x... npx tsx agents/sentinel/run.ts            # report only
SENTINEL_PRIVATE_KEY=0x... npx tsx agents/sentinel/run.ts --dispute  # also dispute every fault
```

| Variable | Default | Meaning |
|---|---|---|
| `SENTINEL_PRIVATE_KEY` | required | Your wallet. It never leaves your machine. |
| `MIMIR_API` | `https://mimirmarkets.xyz` | Where bundles are fetched. |
| `SENTINEL_LOOKBACK_BLOCKS` | `200000` | How far back to scan for proposals (5,000-block log chunks). |
| BSC chain variables | — | `BSC_NETWORK`, `BSC_RPC`, `MIMIR_BSC_V3_ADDRESS`, `MIMIR_BSC_POOL_ADDRESS`, `MIMIR_BSC_USDC_ADDRESS` (read by `lib/chains/registry.ts`). |

On start it warns if your wallet holds no Agent ID: without one it can only dispute markets it is in.

### What it signs

With `--dispute`, for each faulty proposal, exactly two transactions:

1. `approve(marketContract, DISPUTE_BOND)`: the exact bond, never an unlimited allowance.
2. `disputeResolution(id)` (VS) or `dispute(id)` (pool).

Without `--dispute` it signs nothing.

### Before you dispute

- **Read the fault.** A dispute costs 2 USDC if the arbiter keeps the result. Checks 1–4 are mechanical. Check 5
  depends on price sources you fetched, which can lag or differ.
- **Zero hash.** An uncontested pool refund is proposed with `evidenceHash = 0x00…00` and no bundle. There is nothing
  to dispute: everyone gets their stake back.
- **Show your evidence.** Publish the disputed step with its two-hash proof (`porProof`) so the arbiter and everyone
  else can check it without the rest of the bundle.

## Related

- [PROOF-OF-REASONING.md](PROOF-OF-REASONING.md): the commitment Sentinels verify.
- [how-mimir-works.md](how-mimir-works.md): the oracle pipeline, disputes and permissions.
