# Arc as the base layer: design

Branch: `feat/arc-base-layer`. Status: **design proven by a proof of concept, not built.** `main` stays as it is
and keeps serving mimirmarkets.xyz (Solana devnet) until this branch is complete.

## The decision

- Markets, stakes, settlement and payouts all live on **Arc**. No Solana program, no 5 SOL of program rent, no
  MagicBlock Ephemeral Rollup.
- Users keep connecting a **Solana wallet**: it is their identity, it funds them over CCTP, and it proves their
  **$MIMIR** holding for boosts and perks (`lib/token-proof.ts`, `lib/server/holder.ts`, unchanged).
- On Arc every user has a **Circle Modular Wallet**: an ERC-4337 smart account owned by a **passkey** on the user's
  device (Face ID, Touch ID, device PIN). The passkey signs every Arc action; **Circle Gas Station** pays the gas.
  Mimir holds no key and runs no relayer.
- `MimirV3` (from the old repo, Arc native-USDC mode) is the market contract, with the review fixes below.
  `msg.sender` is the user's own smart account, so positions and payouts belong to the user.

Why not a relayer (the first draft): it needs a hot key that can act for every user, a per-user `MimirAccount`
contract to limit it, and a leaked key could still drain value through MimirV3 within the caps (review finding 1).
The passkey model removes the key, the extra contract and most of that risk, and the POC showed it works end to end.

Checked 2026-10-06: Arc mainnet is live (since 2026-09-16). CCTP lists Arc (domain 26) and Solana (domain 5) on
mainnet, Fast Transfer from Solana
([supported blockchains](https://developers.circle.com/cctp/cctp-supported-blockchains)). Circle Wallets supports
Arc mainnet and testnet for modular wallets (MSCA)
([wallets: supported blockchains](https://developers.circle.com/wallets/supported-blockchains)).

## Architecture

```
 Solana (user's wallet)                         Arc
 ──────────────────────                         ─────────────────────────────────────────────────
 USDC ──depositForBurn (CCTP, fast)──▶ attestation ──▶ smart account: receiveMessage (sponsored)
                                                           │
 passkey (device) ── signs user ops ──▶ Circle bundler ──▶ smart account ──▶ MimirV3 (claims, stakes)
                                       + Gas Station          ▲   │
                                                              └───┘ payouts pushed back to the account
 USDC ◀── receive_message on Solana ◀── attestation ◀── smart account: approve + depositForBurn (one op)
 $MIMIR balance ──▶ holder proof (perks, campaign boost)
```

### Accounts and identity

- First visit: connect the Solana wallet, create a passkey, get the smart account address (counterfactual: known
  before it is deployed; it deploys on its first operation).
- Bind the two: the Solana wallet signs "this Solana address owns Arc account 0x…" (same shape as the holder proof).
  Stored server side; it is what the campaign, the holder boost and the UI use to join the two identities.
- **Recovery**: offer it at sign-up. A recovery mnemonic derives an EOA that is added as a second signer on the smart
  account; with it a user re-binds a new passkey. Lose both the passkey and the mnemonic and the account is gone.
- Agents with their own EVM key can skip all of this and call `MimirV3` directly. The agent API returns unsigned
  **Arc** transactions instead of Solana ones.

### Deposit (Solana → Arc)

1. The user signs one Solana transaction: CCTP `depositForBurn`, Fast Transfer, `mintRecipient` = their smart account
   (domain 26). They pay the Solana fee (fractions of a cent).
2. The app polls Circle's attestation API, then the smart account calls `receiveMessage` on Arc in a sponsored
   operation (anyone may call it; the money can only go to the recipient in the message).
3. **Bridge once per deposit, never per bet.** Bets are Arc-only.

### Withdraw (Arc → Solana)

1. One sponsored operation from the smart account: `approve` + `depositForBurn` to the user's Solana USDC token
   account (domain 5).
2. Minting on Solana needs a Solana transaction (`receive_message`): the user's wallet sends it, or Mimir's server
   sends it and pays the SOL fee (it cannot redirect the money; the recipient is in the attested message).

### Money in `MimirV3`

USDC on Arc is one balance with two views: native (18 decimals, what `msg.value` spends) and the ERC-20 interface at
`0x3600…0000` (6 decimals). CCTP mints into it and `MimirV3`'s native mode spends it directly (POC step 3).

## Proof of concept (2026-10-06, `scripts/arc-poc/`, Arc testnet + Solana devnet)

| Step | Script | Result |
|---|---|---|
| Passkey account + sponsored op with a zero balance | `run.mjs` | account `0xf221…c36f`, tx `0x3cdd00a0…f3b178` success, via Circle's bundler (EntryPoint v0.7) |
| Solana → Arc, received by the account, gasless | `run-cctp.mjs` | 1 USDC, attested in 6–11 s, **13–18 s end to end**, tx `0xcf9f7deb…5979cd` |
| One balance, two views | `run-cctp.mjs` | `1e18` native = `1000000` ERC-20 after the mint |
| Arc → Solana, approve + burn in one sponsored op | `run-cctp.mjs` | 0.5 USDC, attested in 24 s, minted on devnet (8.53 → 9.03 USDC), tx `0xfa787e5c…197833` |
| `MimirV3` played by two passkey accounts | `run-mimir.mjs` | deployed `0xa2bf…10de7` (5.25M gas, 0.13 USDC); create + challenge gasless with the stake as `msg.value`; oracle proposes, 60 s window, finalize: the winner's account was **pushed 3.90 USDC** (2 stake + 2 profit − 5% of profit), nothing parked |

| This branch's contracts (after the review fixes) | `run-contracts.mjs` | MimirV3 `0x18c9…5155` and MimirPool `0x1032…a220` deployed (0.14 + 0.07 USDC). VS: challenger account pushed **3.90 USDC**. Pool: Y on B, X on A, A wins, the app pushes X's **3.90 USDC** with `claimFor`; `claimFor` for the loser reverts. 0.10 USDC fee on each (5% of profit) |

Not tested by the POC: the real-device prompt (the virtual authenticator approves silently), passkey recovery, and
a session-key module (none documented; batch what can be batched).

**Console setup that works:** Client Key "Allowed Domain" and Modular Wallets → Passkey "Domain Name" both exactly
`mimirmarkets.xyz`. Circle matches the host exactly (subdomains and `localhost:port` are refused); the SDK sends it in
an `X-AppInfo` header. The POC serves its page at that origin inside a headless browser (request interception), so
nothing is deployed. Previews of this branch need their own Console entries, or run on mimirmarkets.xyz only.

## Costs

- **Circle Wallets** ([circle.com/wallets](https://www.circle.com/wallets)): the first 1,000 monthly active wallets
  free, then $0.05 down to $0.02 per wallet a month.
- **Gas Station**: the sponsored gas + 5%. Arc gas is 25 gwei: a user operation is about a cent or less; a
  `MimirV3` deploy was 0.13 USDC.
- **Solana**: users pay their own burn fee on deposit; the withdrawal mint costs Mimir fractions of a cent if the
  server sends it.

## Contract security, before anything holds real USDC

`forge test` on `MimirV3`: 55/55 pass in the old repo; none covers a smart-account caller or the cases below.
Review of 2026-10-06, no critical findings. What changes with the passkey model is noted.

| # | Severity | Where | Issue | Fix |
|---|---|---|---|---|
| 1 | Medium (was High with a relayer) | `createClaim`, `challengeClaim`, `_payWinner` | The caller names `agentOwnerRecipient`. The user signs a hash, not readable calldata, so a compromised front end could name itself and take the agent fee (up to 10% of profit) | Only accept recipients that are registered agent payout wallets (an on-chain allowlist the owner sets with a timelock), or drop the free-form parameter |
| 2 | Medium | `refundExpired` vs `resolveClaim` / `resolveDispute` | After the grace period both are valid; a loser can front-run a late verdict with a refund | Verdicts revert after the grace period |
| 3 | Medium | `resolveDispute` | Pays the bond (`_settleBond`) while the claim is still `ST_DISPUTED`; the payee can re-enter `refundExpired` and settle twice; only the 50k gas stipend stops it | Set state before any transfer; `nonReentrant` on every state-changing function |
| 4 | Medium | `resolveDispute`, `transferOwnership` | The owner is the arbiter with no ownership timelock; a compromised owner can dispute and rule for itself; a loser can stall with cheap disputes | Multisig arbiter, timelocked ownership, keep the bond if a dispute is never ruled on |
| 5 | Low | `_transfer` | Anyone can starve a recipient's 50k-gas push so it is parked (no loss) | The app calls `withdraw()` for the user when `pendingWithdrawals > 0` |
| 6 | Low | whole contract | No reentrancy guard; safety rests on ordering + the gas stipend | Add one |
| 7 | Low | `usdcPermit` | Permit front-running (ERC-20 mode only, not Arc) | try/catch + allowance check |
| 8 | Low | send helper | ERC-20 send to a code-less address counts as success | Misconfigured deploys only |

Sound: payouts never exceed the pot, fees never cut into a winner's stake, pause never blocks settlement or
withdrawals, `multicall` is non-payable and off in native mode. To check on Arc: whether Circle's blocklist applies
to native value transfers. Never deploy with `disputeWindow = 0` on mainnet.

**Size:** runtime 23,653 bytes (via-IR, 200 runs) against the 24,576 limit: about 900 bytes for the fixes.
`optimizer_runs = 1` gives 23,476; beyond that, split the contract.

Before mainnet: a test per fix, invariant/fuzz tests on the money (balances + liabilities vs the contract's USDC),
a fork test on Arc testnet with smart-account callers, Slither clean or every finding explained, and an
**external audit**.

## What moves where

| From | What | Into this branch |
|---|---|---|
| old repo `enliven17/mimir` | `contracts/MimirV3.sol` + Foundry tests | `contracts/`, with the fixes |
| old repo | CCTP code (`lib/cctp.ts`), EVM oracle and council workers, EVM indexer, x402 | `lib/`, `agents/` |
| `scripts/arc-poc/` | passkey account, sponsored ops, CCTP both ways | the app's wallet layer |
| this repo | UI, Terminal, CLI, campaign, Telegram bot, baskets, copy trading, holder proof, agent API shapes | stays |
| this repo | `onchain/` (Anchor), MagicBlock ER code, `lib/solana/*` program clients, Solana indexer | removed |
| this repo | Solana wallet adapter | stays (connect, bind, CCTP deposit, $MIMIR proof) |

## Market contracts (built on this branch, `contracts/`)

- **`MimirV3`: the VS (duel) market**, the default. A creator stakes a claim, challengers take the other side.
  Pool odds: challengers split the creator's stake pro rata. **New: in pool mode the challengers' total is capped at
  5× the creator's stake** (`MAX_POOL_MULTIPLE`, a constant: changing it means a redeploy), so a 2 USDC claim takes at
  most 10 USDC of challenges and every challenger's upside stays meaningful. Fixed odds is unchanged (already capped
  by the creator's liability). All review fixes are in (table below).
- **`MimirPool`: two-sided pool markets**, a separate contract. Anyone stakes on either side; the creator only seeds
  the first stake. Winners take their stake back plus a pro-rata share of the losing side; fee on profit only; if a
  side is empty, or the outcome is a draw or unresolvable, everyone is refunded in full with no fee. Payouts are
  per-user (`claim` / `claimFor`, so a crowded market never runs out of gas settling); a hedger is paid only the
  winning leg. Same oracle proposal, dispute window, refund escape hatch and timelocks as MimirV3.
- **UI rule for both:** every stake button shows "risk X, win at most Y" from the live totals.
- Tests: 107 pass (`forge test`), including smart-account callers, reentrancy attempts and invariant suites (escrow
  solvency, payouts ≤ pot, no winner below their stake, fee only on profit). Runtime sizes: MimirV3 24,453 B
  (123 under EIP-170, built with `optimizer_runs = 1`), MimirPool 11,678 B. Slither not run yet (not installed).

What the app and workers must handle: verdicts revert with `GraceOver()` once `refundExpired` is open; agent fee
recipients must be listed first (`setAgentPayout`, 2-day timelock), otherwise create/challenge revert with
`AgentNotAllowed()`; ownership transfer is timelocked 2 days; in MimirPool the app pushes winners with `claimFor`
after checking `claimable`.

## Council: two wallets per persona

The council plays on Arc and shows on both networks:
- **Arc wallet (where it bets):** a Circle **developer-controlled** wallet per persona. The council is a server-side
  bot, so it signs through Circle's API (no passkey, and the key stays with Circle, not on our servers). The old repo
  already created these for the 10 classic personas (`CIRCLE_COUNCIL_*`, `scripts/circle-create-council-wallets.ts`);
  the 10 philosopher personas still need theirs.
- **Solana wallet (identity):** the existing keys derived from the admin key (`derivePersonaKeypair`), kept as they
  are. The council page shows both addresses per persona, the visible proof that Mimir runs on both networks.
  Funding can go Solana → Arc over CCTP like any user.

## Campaign (decided 2026-10-06)

Restarts on Arc; today's devnet points are not carried over. One leaderboard keyed by the user's **Solana address**:
volume and copies from the bound Arc account, agents, baskets, follows and invites from the off-chain tables as now.
The only Solana read left is the **$MIMIR holder tier** for the boost. `lib/server/campaign.ts` swaps its
`solana_claims` volume query for the Arc index.

## Copy

"Mimir never holds your keys" stays true: the passkey is on the user's device. New lines needed: what a passkey is,
that Arc gas is sponsored, the recovery phrase at sign-up, and that funds move Solana ↔ Arc through Circle's CCTP.
Remove every MagicBlock / Ephemeral Rollup mention.

## Open questions

1. **Audit:** which auditor, and when.
2. **Arbiter:** a multisig (who signs) for disputes, and the ownership timelock length.
3. **Agent fee recipients:** an on-chain allowlist of registered agent payout wallets, or drop agent attribution
   from the user path (finding 1).
4. **Real-device UX:** the passkey prompt per bet on phones and desktops; whether to batch more.

## Environments

Arc testnet + Solana devnet (CCTP testnet domains 26 ↔ 5) until everything passes. Then Arc mainnet + Solana
mainnet together, and the live site switches. `main` (Solana devnet) is untouched until then.

## Phases

1. Port `MimirV3` into `contracts/` with its tests; fix the review findings with a test each; smart-account and
   invariant tests; deploy on Arc testnet.
2. Wallet layer in the app: passkey account, bind to the Solana wallet, deposit and withdraw over CCTP, recovery.
3. Port the oracle, council, indexer and agent API to Arc; point the UI at Arc (this branch's preview, not the live site).
4. Copy; external audit.
5. Arc mainnet + Solana mainnet; switch the live site; then the showcase swap (`docs/TODO-arc-showcase.md`).
