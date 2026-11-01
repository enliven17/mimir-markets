# Architecture: markets on Arc, any EVM wallet

Markets, stakes, settlement and payouts live on **Arc**, Circle's stablecoin chain. People connect any **EVM wallet**
(ConnectKit: injected wallets, WalletConnect) on Arc or Base; its address is their account. Markets on **Base** come
next, on their own ERC-20 USDC contracts (`contracts/*Erc20.sol`, `scripts/base/`).

## The shape of it

```
 the user's EVM wallet ── signs and sends ──▶ MimirV3 (VS) / MimirPool on Arc ──events──▶ the backend
        │  (stakes and gas in USDC)                    ▲                                indexer, oracle,
        │                                              │ payouts                        council, creator,
        └── an agent's token (optional) ──▶ Argus (Arc) / Clanker (Base)                hosted agents
```

- **No relayer, no hot key for users.** Every user action is a transaction from the user's own wallet, gas paid in
  USDC on Arc. `msg.sender` is the user, so positions and payouts are theirs.
- **Mimir's own actors** (oracle, council personas, market creator) and hosted agents sign through Circle
  developer-controlled wallets or a dedicated oracle key; no persona key sits on Mimir's servers.
- **Connected agents** bring their own EVM key; the agent API returns unsigned Arc transactions ([AGENTS.md](AGENTS.md)).

## Accounts

- **Connect:** any EVM wallet, on Arc or Base. Connecting never switches the network; a transaction switches to its
  chain right before sending (`components/arc/useEvmWallet.ts`).
- **Prove:** routes that act for a wallet take an EIP-191 signature of a readable message (`lib/owner.ts`); a smart
  wallet's ERC-1271 signature is checked on Arc, then on Base.
- **Open access:** no invite code. Per-account stake caps, rate limits and wallet proofs still apply.
- **One balance, two views:** USDC on Arc is native (18 decimals, what `msg.value` spends) and also the ERC-20 at
  `0x3600…0000` (6 decimals). The market contracts spend it natively.

## Hosted agents (Mimir Launch)

- **Free to create** (`lib/launch/flow.ts`, `convex/launch.ts`): the owner signs once; Mimir makes the agent's Circle
  wallet on Arc and stores it live. No funding step.
- **Staking** (`convex/launchArc.ts`, `lib/launch/markets.ts`): every 10 minutes per agent, its brain gives P(side A)
  for the open pools its rules allow; it stakes the best edge at a fraction of Kelly from its own wallet, which the
  owner funds with USDC and can withdraw from. It may also open markets (`convex/launchMarkets.ts`) when allowed.
- **Copying** (`lib/launch/copy-stake.ts`, `convex/launchCopyJobs.ts`): followers mirror its pool stakes from Circle
  copy wallets of their own, under their own cap.
- **Its token (optional)** (`lib/launch/token.ts`): built server-side for the owner's wallet as creator (Argus on Arc:
  `lib/launch/argus*.ts`, creatorBps 10000; Clanker v4 on Base: `lib/launch/base/`, the owner as admin and only reward
  recipient), signed and sent by the owner, then recorded once its receipt checks out (sender and creator are the
  owner, the symbol is the agent's ticker). Every creator fee goes to the owner, who claims from the agent page
  (Argus splitter `distribute()` + `claim(owner)`; ClankerFeeLocker `claim(owner, WETH)`). Mimir holds nothing.
- **Council agents** have an Arc wallet (`ARC_COUNCIL_WALLETS`) and an optional Base wallet in
  `lib/launch/council.json` (address and Circle wallet id), for Base markets later.

## Market contracts (`contracts/`)

| Contract | What it does |
|---|---|
| `MimirV3` | **VS markets** (the default). The creator backs side A; challengers take side B and, if they win, split the creator's stake pro rata. Challengers together can add at most 5× the creator's stake (`MAX_POOL_MULTIPLE`), and the creator risks at most 5× the challengers' total (the rest comes back). Fixed-odds mode is capped by the creator's liability. |
| `MimirPool` | **Pool markets.** Anyone stakes on either side; winners take their stake back plus a pro-rata share of the losing side. An empty side, a draw or an unresolvable result refunds everyone. Payouts are per user (`claimFor`, sent by the backend). |
| `MimirFees` | The entry-fee rate per account (0.5% standard). |

Both market contracts share the lifecycle:

1. **Open and stake** until 60 seconds before the deadline (`CHALLENGE_LOCK_SECONDS`).
2. **Propose:** after the deadline the oracle proposes a result with a confidence and an evidence hash.
3. **Dispute window:** `disputeWindow` set at deploy (1 hour on testnet, at most 7 days, never 0 on mainnet). A
   participant disputes with `DISPUTE_BOND` = 2 USDC; the arbiter rules. The bond comes back if the result changes
   and goes to the fee recipient if it stands.
4. **Finalize:** winners are paid (VS pushes payouts; a push that fails is parked for `withdraw()`).
5. **Escape hatch:** 7 days after the deadline (`RESOLUTION_GRACE_SECONDS`) anyone can call `refundExpired`. An
   unsettled open or active market refunds in full; a disputed market the arbiter never ruled on **settles to the
   oracle's proposal** and the bond is kept. Verdicts revert with `GraceOver()` once the hatch is open.

Other limits: `minStake` is an immutable deploy parameter (0.01–100 USDC; **0.1 USDC** on testnet, `ARC_MIN_STAKE`
in `scripts/arc/deploy.mjs`), at most 100 challengers, deadline at most a year out, fixed payout at most 10×. Owner,
oracle and fee-recipient changes go through 2-day timelocks. Native USDC only.

## Fees

- **Entry fee on every position** (open, challenge, pool stake), taken from what is sent; the rest is the stake.
  0.5% for everyone, never above 1% (`MAX_ENTRY_BPS`). Kept on refunds.
- **Copy trades:** a position opened with a `referrer` (the basket creator, or the copied agent's owner) pays 1% of
  its net profit to the referrer and 1% to Mimir, on wins only.
- **Agent deploy (API-registered agents):** a flat $1, paid in USDC on Arc and checked by the API. Hosted agents are free.
- **Agents' tokens:** no Mimir fee; the owner keeps every creator fee.
- No other fee on winnings.

## The backend

Scheduled jobs, each run finishing on its own and retried on the next tick (`convex/`):

| Job | Every | What |
|---|---|---|
| Indexer (`arcSync`) | 30 s | Reads both contracts' logs into markets, positions and every transaction (shown on each market page). Posts market events to the Telegram route. |
| Oracle (`arcOracle`) | 1 min | Proposes, finalizes, refunds and pays. A pool with only one side staked is refunded without a model call. Otherwise `agents/oracle/decide.ts`: deterministic rules, then evidence and two price feeds, then a settlement-grade model. 80%+ settles, 60–79% settles marked contested, below 60% refunds. The audit bundle's sha256 goes on chain. A deferred market is retried after 10 minutes. |
| Council (`arcCouncil`) | 5 min | One forecast take per market from the best-suited persona, at most `COUNCIL_TAKES_PER_CREATOR_DAY` (3) a day per market creator. Bets only when `COUNCIL_BETS` is not `0` (off on mainnet). See [COUNCIL.md](COUNCIL.md). |
| Market creator (`arcCreator`) | 1 h | Opens house VS markets from live data within `CREATOR_DAILY_BUDGET_USDC` (default 1 USDC a day at `CREATOR_STAKE_USDC` 0.1), cancels its own unchallenged ones. |
| Hosted agents (`launchArc`, `launchMarketsDb`) | 5 min, 1 h | Agents stake on markets (`LAUNCH_ARC=1`) and open their own when allowed. |

Model keys are split by role so the oracle's quota is never spent by anything else (`lib/llm.ts`): the oracle uses
`ORACLE_GEMINI_API_KEY` (a list is allowed), others never touch those keys. The web app's records (agents, baskets,
copy permissions, Telegram, access, agent payments) live in the backend (`convex/appStore.ts`).

### Jev (optional)

[Jev](https://typesafe.ai) answers typed questions (yes/no, one of a list, a point on a scale) with probabilities in
about 100 ms. Mimir uses it as the cheap first step before a full model, and only when `TYPESAFE_API_KEY` is set
(backend and web). Without the key nothing calls it and nothing changes.

- **Market triage** (`lib/jev-triage.ts`, `convex/arcTriage.ts`): the indexer asks, for each new market, whether it
  can be settled from its source, whether it is spam, and its category. The council skips a take when spam ≥ 0.85
  or settleable ≤ 0.15, and uses Jev's category for persona choice when the creator chose "custom" (≥ 0.8).
- **Claim moderation** (`lib/moderation/jev-moderation.ts`): after the local rules, Jev picks a policy category or
  "none". "none" at ≥ 0.97 allows and a violation at ≥ 0.95 blocks without the model; anything else goes to the
  model as before.
- **Never for settlement.** Verdicts need written, audited reasoning, which Jev does not give.

`JEV_MODEL` pins the version (default `jev-latest`) so a model upgrade cannot shift the thresholds silently. Calls
time out after 2 s and retry once on 429/529; any failure falls back to the path without Jev.

## Security

Contracts: `forge test` (161 tests, including smart-account callers, reentrancy attempts, fee tickets, mainnet
hardening (`MainnetHardening.t.sol`) and invariant suites: escrow solvency, payouts ≤ pot, no winner below their net
stake, copy fees only on profit). Slither: no high or medium findings. Sizes: MimirV3 24,041 B (`optimizer_runs = 1`,
535 B under EIP-170), MimirPool 14,488 B, MimirFees 3,113 B.

### Roles and emergency controls

| Role | Holds | Can |
|---|---|---|
| Owner | a Safe on mainnet | pause, `revokeOracle()` / `revokeSigner()` at once, queue a new oracle, fee recipient or signer (2-day timelock), `vetoProposal`, `setArbiter`, `setCaps`, `setLockAt` |
| Arbiter | a Safe (may be the owner's only with `ARC_ARBITER_IS_OWNER=1`) | `resolveDispute`, the only ruling on disputed and vetoed proposals |
| Oracle | the Convex hot key | propose resolutions; never owner, arbiter or fee recipient (constructor and `queueOracle` revert `RoleCollision`) |
| Fee recipient | a treasury address | receives entry fees, the platform share and forfeited bonds |
| Fee signer | unused by the app | the `MimirFees` ticket signer; the app signs no tickets, and a ticket can only lower a fee |

All roles are constructor arguments; nothing stays on the deployer. On mainnet `scripts/arc/deploy.mjs` refuses a
missing role, a role equal to the deployer, colliding roles, and an owner or arbiter without code.

- **Pause** stops new positions, proposals, `finalize`, rulings and winners' pool payouts. Funds can still leave:
  cancel, `withdraw`, refunds (draws, empty sides, unresolvable), and `refundExpired`, which while paused refunds every
  stake instead of honouring a proposal and returns any dispute bond.
- **Veto:** the owner moves a proposal to the arbiter inside the dispute window (`ResolutionDisputed` with a zero
  disputer). If the arbiter never rules, `refundExpired` refunds the market.
- **Dispute window:** at least 24 h off Arc testnet (`WindowTooShort`); the mainnet default is 86,400 s.
- **Caps:** `setCaps(maxMarketStake, maxAccountStake)`, net USDC, 0 = none; they gate only new stakes (`CapExceeded`).
- **Early lock:** `setLockAt(id, at)`, by the creator or owner, closes a market to new stakes before the usual lock
  (kickoff). It can only move earlier and must sit at least the lock period before the deadline (`LockSet` event).

### First review (2026-10-06)

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | Medium | A free-form fee recipient on each call let a compromised front end take the agent fee | The agent fee is gone; the field is now `referrer`, worth a fixed 1% of a copy's profit |
| 2 | Medium | `refundExpired` and a late verdict were both valid after the grace period | Verdicts revert after the grace period |
| 3 | Medium | `resolveDispute` paid the bond before changing state | State first; `nonReentrant` on every state-changing function |
| 4 | Medium | The owner is the arbiter with no ownership timelock | Timelocked ownership; multisig arbiter before mainnet; unruled disputes settle to the proposal |
| 5 | Low | A recipient's 50k-gas push can be starved (no loss) | Parked payouts, pulled with `withdraw()` |
| 6–8 | Low | No reentrancy guard; ERC-20 permit and send edge cases | Guard added; ERC-20 mode removed |

### Second review (2026-10-07)

| # | Severity | Issue | Fix |
|---|---|---|---|
| H-1 | High | A dust challenger on a big claim won the creator's whole stake | The creator risks at most 5× the challengers' total; the rest goes back to the creator |
| M-1 | Medium | An unruled dispute refunded everyone, so a loser could buy a refund for the bond | A disputed claim past the grace settles to the proposal; the bond is forfeited |
| L-1, L-2 | Low | Pool copy fees charged on a hedger's own money, and on uncopied stake | Fee on net profit of the copied stake only (`copyA`, `copyB`) |
| L-3 | Low | Tickets from a rotated-out signer stayed valid | Signer epochs; `cancelOwnershipTransfer()` |
| Caps | Low | Unbounded inputs | Payout ≤ 10×, deadline ≤ 1 year, entry fee ≤ 1% |

## Costs

- **Circle Wallets:** the first 1,000 monthly active wallets free, then $0.05 down to $0.02 a wallet a month.
- **Gas:** paid by each wallet in USDC on Arc; about a cent or less at 25 gwei.
- **The house:** the market creator's daily budget (default 1 USDC) and, on testnet, council bets.

## Before mainnet

1. External audit of the three contracts.
2. Safes deployed first as owner and arbiter; separate oracle, fee recipient and fee signer keys
   (deploy.mjs enforces it). Start with caps set.
3. Arc mainnet addresses checked against Circle's docs.
4. `COUNCIL_BETS=0`, key management for the oracle, fee signer and Circle entity secret.
5. Dispute window 24 h or more (the contracts refuse less off testnet).

## Proof of concept

`scripts/arc/usdc-allowance-proof.mjs` shows on Arc testnet that the USDC ERC-20 (6 dp) and the native balance (18 dp)
are one balance: an approve + `transferFrom` moves the native balance on both sides.
