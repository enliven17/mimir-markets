# Architecture: markets on Arc, wallets on Solana

Markets, stakes, settlement and payouts live on **Arc**, Circle's stablecoin chain. People keep their **Solana**
wallet: it is their identity, it funds them over CCTP, and it holds **$MIMIR**, which lowers fees and opens the door
at launch. This build runs on Arc testnet + Solana devnet; Arc mainnet + Solana mainnet come together, invite-only.

## The shape of it

```
 Solana (the user's wallet)                      Arc
 ──────────────────────────                      ─────────────────────────────────────────────────
 USDC ──depositForBurn (CCTP, fast)──▶ attestation ──▶ smart account: receiveMessage (sponsored)
                                                           │
 passkey (device) ── signs user ops ──▶ Circle bundler ──▶ smart account ──▶ MimirV3 (VS) / MimirPool
                                       + Gas Station          ▲   │                 │
                                                              └───┘ payouts          │ events
 USDC ◀── receive_message on Solana ◀── attestation ◀── smart account: approve + depositForBurn
 $MIMIR balance ──▶ fee ticket (lower entry fee), invite-only access                 ▼
                                                              the backend: indexer, oracle, council, creator
```

- **No relayer, no hot key for users.** Every user action is a user operation signed by the user's passkey; Circle's
  Gas Station pays the gas. `msg.sender` is the user's own smart account, so positions and payouts are theirs.
- **Mimir's own actors** (oracle, council personas, market creator) sign through Circle developer-controlled
  wallets or a dedicated oracle key; no persona key sits on Mimir's servers.
- **Agents** bring their own EVM key; the agent API returns unsigned Arc transactions ([AGENTS.md](AGENTS.md)).

## Accounts

- **Create:** connect the Solana wallet, create a passkey (Face ID, fingerprint, device PIN), get a Circle Modular
  Wallet (ERC-4337 smart account). Its address is known before it deploys; it deploys on its first operation.
- **Link:** the Solana wallet and the smart account each sign one message naming the other
  (`app/api/arc/bind`). The link is what fee tickets, the campaign, invites and Telegram use to join the two.
- **Recover:** at sign-up the user downloads a 12-word recovery file and confirms it. The words derive an EOA added as
  a second owner of the smart account; with them a new passkey can be put on the same account. Lose both and the
  account is gone.
- **Invite-only (mainnet):** a wallet holding `MIMIR_ACCESS_MIN` $MIMIR (default 5M) gets in; anyone else needs a
  code. Every member gets `MIMIR_INVITES_PER_USER` codes (default 2; raising it tops everyone up). Off on testnet
  unless `NEXT_PUBLIC_INVITE_ONLY=1`. The bind route enforces it, so skipping the UI gains nothing
  (`lib/server/access.ts`, `components/access/AccessGate.tsx`).

## Moving money

- **Deposit (Solana → Arc):** one Solana transaction, CCTP `depositForBurn` with Fast Transfer and the smart account
  as recipient (domain 5 → 26). The app waits for Circle's attestation, then the account calls `receiveMessage` in a
  sponsored operation. 13–18 s end to end on testnet. Bridge once per deposit, never per bet.
- **Withdraw (Arc → Solana):** one sponsored operation, `approve` + `depositForBurn` to the user's Solana USDC
  account; the mint on Solana is a Solana transaction the wallet sends.
- **One balance, two views:** USDC on Arc is native (18 decimals, what `msg.value` spends) and also the ERC-20 at
  `0x3600…0000` (6 decimals). CCTP mints into it; the market contracts spend it natively.

## Market contracts (`contracts/`)

| Contract | What it does |
|---|---|
| `MimirV3` | **VS markets** (the default). The creator backs side A; challengers take side B and, if they win, split the creator's stake pro rata. Challengers together can add at most 5× the creator's stake (`MAX_POOL_MULTIPLE`), and the creator risks at most 5× the challengers' total (the rest comes back). Fixed-odds mode is capped by the creator's liability. |
| `MimirPool` | **Pool markets.** Anyone stakes on either side; winners take their stake back plus a pro-rata share of the losing side. An empty side, a draw or an unresolvable result refunds everyone. Payouts are per user (`claimFor`, sent by the backend). |
| `MimirFees` | Entry-fee tiers and the holder fee tickets. |

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
  0.5% by default, **0.25% for 5M+ $MIMIR, 0.1% for 10M+**, never above 1% (`MAX_ENTRY_BPS`). Kept on refunds.
- **Holder discount:** the token is on Solana, so the server reads the linked Solana wallet's balance and signs an
  EIP-712 `FeeTicket(account, tier, expires)` for 24 hours (`app/api/arc/fee-ticket`). The account applies it in the
  same user operation as its bet. The signer can only lower fees; each ticket records the signer epoch, so rotating
  the signer voids old tickets.
- **Copy trades:** a position opened with a `referrer` (the basket creator, or the copied agent's owner) pays 1% of
  its net profit to the referrer and 1% to Mimir, on wins only.
- **Agent deploy:** $1, $0.50 at 5M, free at 10M, paid in USDC on Arc and checked by the API.
- No fee on winnings.

## The backend

Scheduled jobs, each run finishing on its own and retried on the next tick (`convex/`):

| Job | Every | What |
|---|---|---|
| Indexer (`arcSync`) | 30 s | Reads both contracts' logs into markets, positions and every transaction (shown on each market page). Posts market events to the Telegram route. |
| Oracle (`arcOracle`) | 1 min | Proposes, finalizes, refunds and pays. A pool with only one side staked is refunded without a model call. Otherwise `agents/oracle/decide.ts`: deterministic rules, then evidence and two price feeds, then a settlement-grade model. 80%+ settles, 60–79% settles marked contested, below 60% refunds. The audit bundle's sha256 goes on chain. A deferred market is retried after 10 minutes. |
| Council (`arcCouncil`) | 5 min | One forecast take per market from the best-suited persona, at most `COUNCIL_TAKES_PER_CREATOR_DAY` (3) a day per market creator. Bets only when `COUNCIL_BETS` is not `0` (off on mainnet). See [COUNCIL.md](COUNCIL.md). |
| Market creator (`arcCreator`) | 1 h | Opens house VS markets from live data within `CREATOR_DAILY_BUDGET_USDC` (default 1 USDC a day at `CREATOR_STAKE_USDC` 0.1), cancels its own unchallenged ones. |

Model keys are split by role so the oracle's quota is never spent by anything else (`lib/llm.ts`): the oracle uses
`ORACLE_GEMINI_API_KEY` (a list is allowed), others never touch those keys. The web app's tables (agents, baskets,
campaign, Telegram, access, Arc account links, agent payments) stay in Postgres (`lib/server/db.ts`).

## Security

Contracts: `forge test` (136 tests, including smart-account callers, reentrancy attempts, fee tickets and invariant
suites: escrow solvency, payouts ≤ pot, no winner below their net stake, copy fees only on profit). Slither: no
high-severity findings. Sizes: MimirV3 21,887 B (`optimizer_runs = 1`), MimirPool 12,693 B, MimirFees 2,675 B.

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
- **Gas Station:** sponsored gas + 5%. A user operation is about a cent or less at 25 gwei.
- **The house:** the market creator's daily budget (default 1 USDC) and, on testnet, council bets.

## Before mainnet

1. External audit of the three contracts.
2. A multisig as owner and arbiter.
3. Arc mainnet and CCTP mainnet addresses checked against Circle's docs; Circle Console entries for the domain.
4. `COUNCIL_BETS=0`, invite-only on, key management for the oracle, fee signer and Circle entity secret.
5. Deploy with a non-zero dispute window.

## Proof of concept (2026-10-06, `scripts/arc-poc/`)

| Step | Script | Result |
|---|---|---|
| Passkey account + sponsored op with a zero balance | `run.mjs` | success via Circle's bundler (EntryPoint v0.7) |
| Solana → Arc, received by the account, gasless | `run-cctp.mjs` | 1 USDC, attested in 6–11 s, 13–18 s end to end |
| Arc → Solana, approve + burn in one sponsored op | `run-cctp.mjs` | 0.5 USDC, attested in 24 s, minted on devnet |
| Markets played by passkey accounts | `run-mimir.mjs`, `run-contracts.mjs` | create, challenge, propose, finalize, payouts pushed |

**Circle Console:** the Client Key "Allowed Domain" and Modular Wallets → Passkey "Domain Name" must both be exactly
`mimirmarkets.xyz` (subdomains and `localhost:port` are refused). The end-to-end scripts serve the page at that
origin inside a headless browser (request interception), so nothing is deployed.
