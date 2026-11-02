# Architecture: markets on Base and Arc, any EVM wallet

Markets, stakes, settlement and payouts live on chain, on two networks with their own contracts and their own
markets:

- **Base** (primary): `MimirV3Erc20` (VS) and `MimirPoolErc20` (pools) with Circle's ERC-20 USDC (6 decimals). Gas is
  ETH. Base Sepolia on testnet.
- **Arc** (Circle's stablecoin chain): `MimirV3` and `MimirPool` with native USDC (18 decimals), which also pays the
  gas. It is currently disabled and can be restored by setting both `NEXT_PUBLIC_MARKET_CHAINS=base,arc` on Vercel
  and `MARKET_CHAINS=base,arc` in Convex, then rebuilding the site. Keep its contracts and wallets configured.

People connect any **EVM wallet** (ConnectKit: injected wallets, WalletConnect); the same address is their account on
both. Each market lives on its own chain, but every public **pool** exists on every enabled chain: Mimir's agents open
theirs on each chain, and Mimir's house creator opens the twin of anyone else's pool, and the copies are linked
(below). A user stakes on whichever chain they want. VS duels are not mirrored.

## The shape of it

```
 the user's EVM wallet ── signs and sends ──▶ MimirV3 / MimirPool on Base or Arc ──events──▶ the backend
        │  (Base: USDC + ETH gas;                       ▲                                one indexer per chain,
        │   Arc: USDC, gas in USDC)                     │ payouts                        oracle, council, creator,
        └── an agent's token (optional) ──▶ Argus (Arc) / Clanker (Base)                hosted agents
```

- **No relayer, no hot key for users.** Every user action is a transaction from the user's own wallet. `msg.sender`
  is the user, so positions and payouts are theirs.
- **Mimir's own actors** (oracle, council personas, market creator) and hosted agents sign through Circle
  developer-controlled wallets or a dedicated oracle key; no persona key sits on Mimir's servers.
- **Connected agents** bring their own EVM key; the agent API returns unsigned transactions for the chain they name
  ([AGENTS.md](AGENTS.md)).

## Chains in code

One registry, `lib/chains/registry.ts`, describes each market chain: id (`base` | `arc`), network, chain id, RPCs,
explorer, gas token, USDC (native 18 dp or ERC-20 6 dp, address, permit), contracts, deploy block and minimum stake.
The browser reads `NEXT_PUBLIC_*` names (`MARKET_CHAINS`), the backend its own (`serverMarketChains`). A chain is
**enabled** when both market contracts are set and it is in `NEXT_PUBLIC_MARKET_CHAINS` / `MARKET_CHAINS` (default
`base`). A chain without contracts is simply off: no index, no oracle, no UI, never a crash. The default chain for
new markets is Base when enabled (`NEXT_PUBLIC_DEFAULT_MARKET_CHAIN` overrides). `lib/arc/config.ts` keeps the Arc
specifics and feeds the registry.

**Amounts.** Off chain every USDC amount is one unit: an 18-decimal integer ("index units", what Arc's native USDC
already is). The Base indexer scales 6-dp amounts by 1e12 on the way in, so the index, quotes, the UI and agent sizing
never care which chain a number came from. Transaction builders scale back exactly (`lib/chains/amounts.ts`): an
amount finer than 6 decimals is refused (`SubUnitAmountError`), and computed amounts (a max that fits, a Kelly size)
are rounded down first, so the dust stays with the user.

**Base transactions** (`lib/chains/calls.ts`, `lib/chains/send.ts`). The contract pulls the USDC with `transferFrom`:

- the allowance already covers it: the call alone;
- a pool create, stake or dispute: the wallet signs an EIP-2612 permit, then one transaction (`...WithPermit`); a
  wallet that cannot sign typed data falls back to approve + call;
- VS (no permit variants: EIP-170 size): approve exactly the amount, then the call.

A wallet with no ETH on Base is stopped before the wallet opens, with a plain message. Base calldata carries Mimir's
ERC-8021 Builder Code when `NEXT_PUBLIC_BASE_BUILDER_SUFFIX` is set.

**Routes.** A market page is `/arena/<chain>/<kind>/<id>`; `/arena/arc/<kind>/<id>` (every older link) is the same
route with `chain = arc`. Share refs are `<kind>-<id>` on Arc and `base-<kind>-<id>` on Base.

## Linked markets and twins

Every public pool should exist on every enabled chain, linked by a shared `pairKey` (`lib/chains/linked.ts`,
`marketLinks` and `arcMarkets.pairKey`). The money stays separate per chain: each leg is its own pool with its own
stakes, odds and payouts.

- **House creator and hosted agents** open each draft on every chain they can fund, under one pairKey (`house:…`,
  `agent:<slug>:…`), whenever more than one chain is enabled, even if only one chain could open it right then.
- **The twin reconciler** (`convex/arcTwins.ts`, every 15 minutes; `lib/chains/twin-reconciler.ts`,
  `lib/chains/twins.ts`) finds open public pools missing a leg and fills it from the **house creator wallet** on that
  chain, with the same question, labels, category, deadline and source, then links both legs (`twin:<chain>:pool:<id>`
  when the source had no pairKey). It covers a house or agent leg that failed (no ETH, no USDC, a Circle error) and
  every **user-created pool**:
  - only once indexed, and past moderation (the local rules of `lib/moderation/local-rules.ts`, then Jev when
    `TYPESAFE_API_KEY` is set) and triage (`arcTriage`: spam ≥ 0.85 or settleable ≤ 0.15 is skipped; with Jev on it
    waits up to 30 minutes for the triage row);
  - the create needs a seed stake: **the target chain's minimum stake, on the side the user staked**. It is Mimir's
    money, counted against the house creator's budget (a house draft's twin is seeded like the creator:
    `CREATOR_STAKE_USDC` on side A);
  - skipped when betting would close within `TWIN_MIN_LEAD_MINUTES` (30) of now (the contracts lock 60 s before the
    deadline, or earlier at a `lockAt`), when the deadline is over a year out, and after `TWIN_MAX_ATTEMPTS` (3)
    failed opens (a twin the contract rejects; each failure releases its budget and backs off);
  - at most `TWIN_PER_CREATOR_DAY` (3) twins a day per user, `TWIN_PER_TICK` (4) opens per run;
  - an identical pool already on the other chain (same question, sides, source, deadline) is linked instead of a new
    one, which also repairs a link lost after a crash.
- **VS duels are not mirrored**: a duel is one person's challenge to whoever takes it, with a creator-side stake and a
  5× cap that do not translate into a house-seeded copy.
- **The house budget is one budget for every chain**: `CREATOR_DAILY_BUDGET_USDC` (default 1 USDC a day, UTC) covers
  the creator's drafts and every twin on every chain. Each open reserves its seed in `houseSpend`
  (`convex/houseBudget.ts`) before it is sent and releases it if the send fails; spent today is the larger of that
  ledger and the house's indexed positions on markets it opened today. `CREATOR_DAILY_MARKETS` still counts the
  creator's own drafts per chain (twins of other people's pools do not count).

**One decision per pair.** The oracle decides the outcome once per pairKey and proposes the same decision on every
leg: the decision is stored (`arcPairDecisions`) right after the model decides and before any leg proposes it, so
every leg, the deciding leg's retry included, reuses it; the legs share one backoff while it is deferred (one leg
waiting on a game means the other waits too, instead of asking the model again); and if the house holds a position on
any leg (its own draft, a twin's seed, a council stake), the pair's decision is held to the house bar (firm verdicts
only), whichever leg it is made on. This means a user pool with a house twin settles at 80%+ confidence or refunds.
What stays per leg is what depends on its own stakes: an uncontested pool refunds, stakes placed after the outcome was
known refund. A mainnet market never reuses a decision made for a testnet one.

**One council take per pair.** The council writes one take for a linked pair (one model call) and stores it on every
leg; a leg that appears later gets a copy (`arcCouncilDb.copyTake`). The daily take cap counts against the person who
opened the question, not the house twin. Council *bets* stay per leg (each chain's wallet stakes its own money).

**On the page.** A linked market's page shows each leg's pool, odds and status side by side (never summed: the pools
settle separately), with "Stake on Base / Stake on Arc": the stake box switches to the chosen leg and the wallet on its
chain. The Arena shows one card per linked market, both networks' pools side by side and a link to stake on each.

## Accounts

- **Connect:** any EVM wallet. Connecting never switches the network; a transaction switches to its chain right before
  sending (`components/arc/useEvmWallet.ts`). The wallet menu and the portfolio show USDC on every enabled chain (and
  ETH for gas on Base).
- **Prove:** routes that act for a wallet take an EIP-191 signature of a readable message (`lib/owner.ts`); a smart
  wallet's ERC-1271 signature is checked on Arc, then on Base.
- **Open access:** no invite code. Per-account stake caps, rate limits and wallet proofs still apply.
- **Arc USDC, one balance, two views:** native (18 decimals, what `msg.value` spends) and the ERC-20 at `0x3600…0000`
  (6 decimals). The Arc market contracts spend it natively.

## Hosted agents (Mimir Launch)

- **Free to create** (`lib/launch/flow.ts`, `convex/launch.ts`): the owner signs once; Mimir makes the agent's Circle
  wallets (Arc, and Base: blockchain `BASE` / `BASE-SEPOLIA`) and stores it live. No funding step. A Base wallet that
  could not be made then is made by its first Base tick (needs `CIRCLE_WALLET_SET_ID` in the Convex env).
- **Staking** (`convex/launchArc.ts`, `lib/launch/markets.ts`): every 10 minutes per agent and per chain its rules
  allow (`chains`, default both), its brain gives P(side A) for the open pools there; it stakes the best edge at a
  fraction of Kelly from its own wallet on that chain. On Base that is approve + stake, and gas is ETH: **there is no
  gas station, the owner (or Mimir) sends the agent's Base wallet a little ETH.** The owner funds and withdraws per
  chain from the agent page. It may also open markets (`convex/launchMarkets.ts`) when allowed, linked across chains.
- **Copying** (`lib/launch/copy-stake.ts`, `convex/launchCopyJobs.ts`): followers mirror its pool stakes from Circle
  copy wallets of their own, under their own cap. **Copies follow the leader's chain**: a Base stake is copied from
  the follower's Base copy wallet, an Arc stake from the Arc one. Basket copies do the same.
- **Its token (optional)** (`lib/launch/token.ts`): built server-side for the owner's wallet as creator (Argus on Arc:
  `lib/launch/argus*.ts`, creatorBps 10000; Clanker v4 on Base: `lib/launch/base/`, the owner as admin and only reward
  recipient), signed and sent by the owner, then recorded once its receipt checks out (sender and creator are the
  owner, the symbol is the agent's ticker). Every creator fee goes to the owner, who claims from the agent page
  (Argus splitter `distribute()` + `claim(owner)`; ClankerFeeLocker `claim(owner, WETH)`). Mimir holds nothing.
- **Council agents** stake from `ARC_COUNCIL_WALLETS` on Arc and `BASE_COUNCIL_WALLETS` on Base
  (`scripts/arc/council-wallets.ts --chain base` makes them). A persona with no wallet on a chain does not stake there.

## Market contracts (`contracts/`)

Base runs the ERC-20 ports (`MimirV3Erc20`, `MimirPoolErc20`; their header comments list every difference: USDC
pulled with `transferFrom`, the pool's permit variants, `DISPUTE_BOND` 2e6, failed payout pushes parked for
`withdrawTo`). Every rule below holds on both chains. Deploy: `scripts/base/deploy-markets.mts` (Base),
`scripts/arc/deploy.mjs` (Arc). `MimirFees` is the same contract on both.

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
| Indexers (`arcSync`, one per chain) | 30 s | Reads both contracts' logs into markets, positions and every transaction (shown on each market page), Base amounts scaled to 18 dp. Base stays `BASE_CONFIRMATIONS` (6) blocks behind its head. Posts market events to the Telegram route. Cursors are per chain (`arcCursor` name `arc` / `base`). |
| Oracle (`arcOracle`) | 2 min | One pass per enabled chain, one key (`ORACLE_KEY`). Linked markets: one stored decision per pair, shared backoff. Proposes, finalizes, refunds and pays. A pool with only one side staked is refunded without a model call. Otherwise `agents/oracle/decide.ts`: deterministic rules, then evidence and two price feeds, then a settlement-grade model. 80%+ settles, 60–79% settles marked contested, below 60% refunds. The audit bundle's sha256 goes on chain. A deferred market is retried after 10 minutes. |
| Council (`arcCouncil`) | 15 min | On every enabled chain, from that chain's wallets. One forecast take per market (one per linked pair, on every leg) from the best-suited persona, at most `COUNCIL_TAKES_PER_CREATOR_DAY` (3) a day per market creator. Bets only when `COUNCIL_BETS` is not `0` (off on mainnet). See [COUNCIL.md](COUNCIL.md). |
| Market creator (`arcCreator`) | 1 h | Opens house pools from live data on every enabled chain where `ARC_CREATOR_WALLET` / `BASE_CREATOR_WALLET` is set, linked, within `CREATOR_DAILY_BUDGET_USDC` for all chains together (default 1 USDC a day at `CREATOR_STAKE_USDC` 0.1); cancels its own unchallenged VS claims. |
| Twins (`arcTwins`) | 15 min | Opens the missing leg of every open public pool from the house creator wallet and links it (above). |
| Watchdog (`arcWatch`) | 10 min | Per chain: roles, pause, proposals that are not our oracle's, disputes, stuck markets, low gas (USDC on Arc, ETH on Base). |
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

Base source update (2026-11-02): private VS claims use creator-managed wallet grants through `setInvited`;
legacy invite-key strings confer no access. A private rematch starts with no grants. Both Base market contracts
also allow paused, undisputed proposals to refund after a full seven-day grace from the proposal. These changes
require fresh deployments and do not update the existing Arc or Base contracts. See the
[security update](releases/base-contract-security-2026-11-02.md) for exact behavior and verification scope.

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

## The oracle key

One key signs settlements on every chain: `ORACLE_KEY` (Convex env). The contracts' `oracle` role is that key's
address on Base and on Arc. `ARC_ORACLE_KEY` is still read as a deprecated alias when `ORACLE_KEY` is unset;
`BASE_ORACLE_KEY` is no longer read (the watchdog reports a leftover one, a conflicting alias, or no key at all).
Both deploy scripts take `ORACLE_ADDRESS` (or the chain's own `BASE_ORACLE` / `ARC_ORACLE`, or derive it from
`ORACLE_KEY`), print it, refuse an address that is not `ORACLE_KEY`'s, and read the other chain's deployed pool
(`MIMIR_POOL_ADDRESS` + `ARC_RPC` for the Base deploy, `MIMIR_BASE_POOL_ADDRESS` + `BASE_RPC` for the Arc one) to
refuse a different oracle there (`scripts/lib/oracle-role.mjs`). A chain already deployed with another oracle moves to
it with `queueOracle` (2-day timelock). The key pays gas in **ETH** on Base (the watchdog warns under 0.003 ETH) and in
USDC on Arc: keep it funded on both.

## Switching on Base (ops)

1. Deploy: `scripts/base/deploy-markets.mts`; it prints the site and backend env lines.
2. Site env: `NEXT_PUBLIC_BASE_NETWORK`, `NEXT_PUBLIC_BASE_RPC`, `NEXT_PUBLIC_MIMIR_BASE_*`. Backend (Convex):
   `BASE_NETWORK`, `BASE_RPC`, `MIMIR_BASE_*`, `ORACLE_KEY` (the same key as Arc's), `BASE_CREATOR_WALLET`,
   `BASE_COUNCIL_WALLETS`, `CIRCLE_WALLET_SET_ID`.
3. Fund with ETH (gas) and USDC: the oracle (ETH only), the house creator (it also seeds the twins of Arc pools), the
   council's Base wallets.
4. Deploy the backend. The Arc indexer tags pre-Base rows `chain: "arc"` on its first tick (`convex/chainMigrate.ts`);
   `npx convex run chainMigrate:run` does the same by hand. Until it has run, Arc reads may miss rows for a tick.
5. To switch Arc off later: `NEXT_PUBLIC_MARKET_CHAINS=base` and `MARKET_CHAINS=base`. Open Arc markets still settle
   on chain through `refundExpired` if the oracle stops; keep Arc enabled on the backend until they are settled.

## Costs

- **Circle Wallets:** the first 1,000 monthly active wallets free, then $0.05 down to $0.02 a wallet a month.
- **Gas:** paid by each wallet: USDC on Arc (about a cent or less at 25 gwei), ETH on Base (a fraction of a cent).
- **The house:** the market creator's daily budget (default 1 USDC, every chain together, twins' seeds included) and,
  on testnet, council bets.

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
