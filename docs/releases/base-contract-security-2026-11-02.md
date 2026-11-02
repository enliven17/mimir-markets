# Base contract security update — November 2, 2026

This source change addresses the private-invite disclosure report and a related refund failure reproduced during
review. Scope: `MimirV3Erc20` and `MimirPoolErc20` for Base. Arc contracts are unchanged. This is an internal review
and regression test record, not an independent external audit or evidence that a live market was exploited.

## Findings and changes

| Severity | Finding | Change |
|---|---|---|
| Medium | A private VS claim's bearer key was visible in creation, rematch and challenge calldata. A stranger could join, occupy a slot and consume fixed liability or pool capacity. | Authorize `msg.sender` against creator-managed, per-claim wallet grants before any fee lookup or USDC pull. |
| Medium | A paused, undisputed proposal could neither finalize nor use `refundExpired`, even after its dispute window and grace expired. This affected VS and pool. | Permit paused proposals to refund after a full grace measured from the proposal. |

Locations: [VS private-entry authorization](../../contracts/MimirV3Erc20.sol#L850),
[VS refund eligibility](../../contracts/MimirV3Erc20.sol#L1026), and
[pool refund eligibility](../../contracts/MimirPoolErc20.sol#L672).

Three regression tests were first run against the original code. The copied-key test incorrectly admitted the
stranger; the VS and pool refund tests reverted with `Mimir: not active` and `NotOpen()`. All three pass with the
fixes.

## Private VS access

1. Create a claim with `isPrivate = true`. It starts with no authorized wallets. The legacy `inviteKey` string can
   be empty; it is ignored by create, rematch and challenge. `inviteKeyHash` remains an always-zero legacy field
   to preserve the existing claim getter's shape.
2. The claim's creator calls `setInvited(claimId, accounts, true)` for the intended participant wallets, up to 100
   addresses per transaction. This permission is bound to this contract, claim id and caller wallet. Seeing or
   copying the grant transaction or a participant's challenge calldata gives a different wallet no authority.
3. An invited wallet approves USDC and calls `challengeClaim` normally. An account contract must itself be
   invited; its owner's EOA is a different participant.
4. The creator can revoke future entry with `setInvited(claimId, accounts, false)` while the claim is open or
   active. A grant or revocation never modifies an already-funded position, payout or dispute eligibility.
   The protocol owner cannot change another creator's grants. Zero addresses and self-invites are rejected.
5. Every rematch gets its own empty grant list, even when the original creator rematches. An invite to one claim
   never authorizes entry to another claim that uses the same legacy string.

The existing create/challenge/rematch function selectors are preserved. The client ABI adds `setInvited` and
`invited`; `setClaimInviteesCall` builds a grant/revocation transaction without a USDC approval. `NewMarketInput`
supports private Base VS creation and refuses private Arc/pool creation, where these wallet grants are absent.
The standard market form still creates public markets. Wallet grants restrict participation; they do not hide
questions, stakes, transaction inputs or addresses from the public chain.

## Refund policy

- An unresolved active VS claim or open pool refunds after deadline + seven days.
- An undisputed proposal on an unpaused contract remains finalizable to the proposal. It cannot be converted to
  a refund by a participant waiting out the grace.
- An undisputed proposal on a paused contract refunds after proposal time + seven days. A late proposal gets a
  full grace; the deadline's older grace cannot be used to bypass the dispute window.
- A participant-disputed proposal whose arbiter never rules still settles to the proposal after its grace and
  forfeits the bond. A cheap dispute cannot buy a refund.
- A vetoed proposal, or a disputed proposal while paused, refunds the net stakes and returns any participant
  bond after the grace. That grace starts at the latest of the deadline, proposal and dispute timestamps.
- Entry fees remain earned on refund. Refund settlement prevents later finalization or duplicate payment. Pool
  participants collect their refunds through `claim`/`claimFor`, which remain available while paused.

Settlement payout math, the creator risk cap, copy/referrer fee rates and `MimirAgentPay` are unchanged. Tests cover
USDC conservation with entry and copy fees, hedge losses, uncopied top-ups, liability and slot preservation,
dispute/veto bond treatment, refunds and replay rejection. These results do not establish an external audit of
all payout or governance behavior.

## Verification

| Check | Result |
|---|---|
| Full Foundry suite with `BASE_MAINNET_FORK_RPC=https://mainnet.base.org` | 247 passed, zero failed/skipped, including seven fork tests with canonical Base USDC and Safe |
| Base VS / pool unit suites | 69 passed, including two fuzz tests with 256 cases each |
| `npm run test:smoke` | 601 passed, zero failed |
| `npm run typecheck` | Blocked by three existing errors in the untouched, untracked `scripts/arc-poc/_privy-test.ts` (removed Solana imports and their resulting implicit-any error) |
| Same project typecheck excluding only that PoC | Zero errors |
| Separate typecheck of `scripts/base/preflight-mainnet.mts` | Zero errors |
| Optimized deployed runtime (Solidity 0.8.28, via-IR, runs 1) | VS 24,446 bytes; pool 16,863 bytes; both below the 24,576-byte Base limit |

The contract-size regression test checks deployed runtime explicitly; Foundry's permissive test deployments alone
are not sufficient proof of EIP-170 compatibility. Missing-claim checks in Base VS use `ClaimNotFound()` to keep
the wallet-grant update inside that limit. All verification above ran locally; fork writes never broadcast to
Base, and no live deployment, pause, refund or settlement was sent.

## Deployment

The November 1 Base Sepolia addresses in `BASE-TESTNET.md` predate this change and remain legacy deployments.
Neither Base market contract has an upgrade path. Deploy fresh VS and pool contracts, verify their source and
runtime, then bind a fresh backend/index and switch the frontend/backend addresses and first block together.
Existing deployment bindings cannot be reset or rebound. Existing positions remain on their original contracts;
keep their settlement path available, since changing configuration does not migrate them or change their payout
rules.

The mainnet preflight now refuses VS deployments without the new wallet-grant getter. This is a compatibility
check, not a substitute for verifying deployed bytecode. An independent external audit and the existing mainnet
acceptance checks remain required before real-fund activation.
