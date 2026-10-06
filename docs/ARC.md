# Arc as the base layer: design

Branch: `feat/arc-base-layer`. Status: **design, not built.** `main` stays as it is and keeps serving
mimirmarkets.xyz (Solana devnet) until this branch is complete.

## Proof of concept results (2026-10-06, `scripts/arc-poc/`)

Tested the **Circle Modular Wallets** alternative to the relayer (passkey-owned smart accounts, ERC-4337, Circle
Gas Station). Both steps passed on Arc testnet + Solana devnet:

1. `run.mjs`: a passkey smart account on Arc testnet sent a gas-sponsored user operation with a **zero balance**
   (account `0xf221…c36f`, tx `0x3cdd00a0…f3b178`, success; sent by Circle's bundler through EntryPoint v0.7).
2. `run-cctp.mjs`: 1 USDC burned on Solana devnet with CCTP V2 fast transfer to a fresh passkey account
   (Solana tx `3Kvc9N39…aMNLF`), attested in **6 s**, received on Arc by the account itself with a sponsored user
   operation calling `MessageTransmitterV2.receiveMessage` (tx `0xcf9f7deb…5979cd`). **13 s end to end**, no gas paid
   by the user on either side except the Solana burn fee.
3. Balance after: `1000000000000000000` native (18 decimals) and `1000000` via the USDC ERC-20 interface (6 decimals):
   **one balance, two views.** So `MimirV3` native mode (`msg.value`) can spend what CCTP mints. Open question closed.

4. `run-cctp.mjs` (way back): the account approved TokenMessengerV2 and burned 0.5 USDC to a Solana token account
   **in one sponsored user operation** (`0xfa787e5c…197833`), attested in 24 s, minted on Solana devnet
   (`4owbatEL…7kidV`): the wallet's USDC went 8.53 → 9.03. **Full round trip works.**
5. `run-mimir.mjs`: current `MimirV3` deployed on Arc testnet (`0xa2bf…10de7`, native USDC, 60 s dispute window,
   5% platform fee; 5.25M gas = 0.13 USDC). Three accounts funded from Solana in one sponsored op. A passkey
   **creator** account opened a claim and a passkey **challenger** account challenged it, both gasless with the stake
   as `msg.value`. The oracle proposed, the window passed, `finalizeResolution` ran: the challenger account was
   **pushed 3.90 USDC directly** (2 stake + 2 profit − 5% of profit), nothing parked. So a Circle smart account
   accepts MimirV3's 50k-gas payout push; the review's concern about contract callers does not bite here.

Costs and limits found (2026-10-06):
- **Pricing** ([circle.com/wallets](https://www.circle.com/wallets)): the first 1,000 monthly active wallets are
  free, then $0.05 down to $0.02 per wallet a month. Gas Station bills the sponsored gas + 5%. Arc gas is cheap:
  25 gwei, so a user operation is roughly a cent or less.
- **Passkey recovery**: optional, set up while the user still has the passkey: a recovery mnemonic derives an EOA
  that is added as a second signer. Lose both and the account is gone. The product must offer this at sign-up.
- **Prompts**: one passkey prompt per user operation (Face ID / Touch ID / device PIN). The POC's virtual
  authenticator approves silently, so real-device UX is untested. No documented session-key module yet: batch what
  can be batched (approve + burn already goes in one op).
- **Contract size**: `MimirV3` runtime is 23,653 bytes (via-IR, 200 runs); the EIP-170 limit is 24,576. About 900
  bytes of headroom for the review fixes; `optimizer_runs = 1` gives 23,476 if needed, beyond that split the contract.

What it means for the design: with Modular Wallets the user's own passkey signs every Arc action, so there is **no
relayer key, no `MimirAccount`, and `MimirV3`'s `msg.sender` is the user's own account** (finding 1 of the review
goes away). The "Mimir never holds your keys" copy stays true. Costs to check: Circle Wallets / Gas Station pricing,
passkey recovery, and the extra prompt (passkey) next to the Solana wallet.

Console setup that works: Client Key **Allowed Domain** and Modular Wallets → Passkey **Domain Name** both exactly
`mimirmarkets.xyz` (Circle matches the host exactly; subdomains and `localhost:port` are refused). The SDK sends the
host in an `X-AppInfo` header; that is what Circle checks.

## The decision

- Markets, stakes, settlement and payouts all live on **Arc mainnet**. No Solana program, no 5 SOL of program rent,
  no MagicBlock Ephemeral Rollup.
- Users keep connecting a **Solana wallet**. They fund with USDC on Solana, it is bridged to Arc, and from then on
  every action happens on Arc.
- A **relayer** (Mimir's server) sends the Arc transactions on the user's behalf, authorised by messages the user
  signs with their Solana wallet. The user never needs an EVM wallet or gas.
- **$MIMIR stays on Solana.** Boosts and perks keep reading the Solana mainnet balance of the connected wallet
  (`lib/token-proof.ts`, `lib/server/holder.ts` already do this).

Checked 2026-10-06: Arc mainnet is live (since 2026-09-16). Circle's CCTP lists Arc (domain 26) and Solana
(domain 5) on mainnet, with Fast Transfer available from Solana as a source
(https://developers.circle.com/cctp/cctp-supported-blockchains).

## Architecture

```
 Solana (user's wallet)                       Arc mainnet
 ─────────────────────                        ───────────────────────────────────────────────
 USDC ──depositForBurn (CCTP, fast)──▶  attestation ──▶ relayer: receiveMessage ──▶ MimirAccount(user)
                                                                                     │  only these moves:
 signs intents (ed25519) ──▶ API ──▶ relayer ──▶ MimirAccount.execute(...) ─────────▶ MimirV3 (claims, stakes)
                                                                                     │  payouts land back
 USDC ◀──receiveMessage on Solana── attestation ◀── MimirAccount.withdrawToSolana ◀──┘  in the account
 $MIMIR balance ──▶ holder proof (perks, campaign boost)
```

### MimirAccount: one per user, keyed by the Solana address

The existing `MimirV3` (old repo, `contracts/MimirV3.sol`) records the position owner as `msg.sender`. With a relayer
sending every transaction, that would make the relayer the owner of everything. So each user gets a small account
contract on Arc, and the account is what calls `MimirV3`:

- Deployed with CREATE2, salt = the user's Solana public key, so its address is known before it exists (the bridge
  can mint into it on the very first deposit; deploy it lazily on first use).
- Callable **only by the relayer**.
- Can only do three things:
  1. call `MimirV3` (create, challenge, dispute, finalize, withdraw from `MimirV3`'s pull balance),
  2. `withdrawToSolana(amount)`: CCTP burn to the **one Solana address fixed at creation** (the user's USDC token
     account), nothing else,
  3. nothing: there is no generic `call(target, data)` and no transfer to an arbitrary address.
- Carries limits enforced on chain: max per position, max per day.

What this buys: if the relayer key leaks, the attacker **cannot transfer money out of the account** directly.
Funds only leave the account into MimirV3 or back to the user's own Solana address.

What it does **not** buy on its own (security review, 2026-10-06): a leaked relayer can still route value to itself
**through MimirV3**: by naming itself `agentOwnerRecipient` (the agent fee, up to 10% of profit), or by creating a
market with a known answer from its own address and having victims' accounts take the losing side. So the account
must also: hard-code `agentOwnerRecipient = address(0)` (or an allowlist), only call a typed list of MimirV3
functions with capped values, and keep the per-position and per-day caps. Caps bound the loss; they do not
remove it. Treat the relayer key as the most sensitive secret in the system.

What it does not buy: the account cannot verify the user's ed25519 signature on chain (no cheap ed25519 on EVM), so
"the user really asked for this bet" is checked by the relayer, off chain. That is the trust users give Mimir, and
the copy must say so (see "Copy that must change").

### Intents

Every action is a message the user signs with their Solana wallet, built like the agent API envelope already is
(`lib/agents/api.ts`: readable text, canonical body hash, nonce, timestamp):

```
Mimir on Arc
action: challenge
claim: 69
side: challenger
amount: 2.00 USDC
account: 0x… (the user's MimirAccount)
nonce: …
expires: …
```

The API verifies the signature against the Solana address the account is bound to, burns the nonce, and only then
hands the call to the relayer. Withdrawals need a signed intent too.

### Deposit (Solana → Arc)

1. The user signs one Solana transaction: CCTP `depositForBurn` of N USDC, Fast Transfer, `mintRecipient` = their
   MimirAccount address on Arc (domain 26).
2. The relayer polls Circle's attestation API, then calls `receiveMessage` on Arc. USDC lands in the account.
3. From here on, bets are Arc-only and instant. **Bridge once per deposit, never per bet.**

To verify on Arc testnet before building on it: USDC on Arc is both the native gas balance (18 decimals) and an
ERC-20 interface (6 decimals). `MimirV3` has a native mode (`usdc == address(0)`, stakes via `msg.value`), which is
what ran on Arc before. Confirm the CCTP mint credits the same balance the account then spends as `msg.value`.

### Withdraw (Arc → Solana)

1. Signed withdraw intent → relayer calls `account.withdrawToSolana(amount)` → CCTP burn on Arc, recipient fixed.
2. Minting on Solana needs a Solana transaction (`receiveMessage`). The relayer sends it and pays the SOL fee
   (fractions of a cent), so the user never needs SOL. A user can also claim it themselves with the attestation.

### Agents

- Registered agents can stay non-custodial: an agent with its own EVM key calls `MimirV3` directly, no relayer.
  The agent API returns unsigned **Arc** transactions instead of Solana ones.
- Agents that only have a Solana key go through a MimirAccount like any user.

### Relayer

- One hot key with only the rights above, never in a plain `.env` on a shared box: Circle Wallets (developer
  controlled) or a KMS. It pays gas in USDC on Arc: monitor and alert on its balance.
- Rate limits per user and globally; a kill switch (pause the relayer without pausing `MimirV3`, so users can still
  withdraw directly if we ever add an owner-signed escape path).

## What moves where

| From | What | Into this branch |
|---|---|---|
| old repo `enliven17/mimir` | `contracts/MimirV3.sol` + Foundry tests | `contracts/`, add `MimirAccount.sol` + tests |
| old repo | CCTP / Gateway code, x402 nanopayments, EVM oracle and council workers, EVM indexer | `lib/`, `agents/` |
| this repo | UI, Terminal, CLI, campaign, Telegram bot, baskets, copy trading, holder proof, agent API shapes | stays |
| this repo | `onchain/` (Anchor), MagicBlock ER code, `lib/solana/*` program clients, Solana indexer | removed |
| this repo | Solana wallet adapter | stays (connect, sign intents, CCTP deposit, $MIMIR proof) |

## Campaign (decided 2026-10-06)

The testnet campaign restarts on Arc; today's devnet points are few and are not carried over. One leaderboard,
keyed by the user's **Solana address** (their identity everywhere): activity is read from the MimirAccount bound to
that address on Arc (volume, copies) and from the off-chain tables as now (agents, baskets, follows, invites). The
only Solana chain read left is the **$MIMIR holder tier** for the boost (`lib/server/holder.ts`, unchanged).
`lib/server/campaign.ts` swaps its `solana_claims` volume query for the Arc index.

## Copy that must change

The relayer holds the power to move funds within the limits above. These say otherwise today and must be rewritten
before this ships: the agent connect page ("Mimir never holds your agent's private key"), copy trading ("nothing is
custodied"), the agent API header ("on-chain writes never touch a key"), `cli/README.md`, `docs/AGENTS.md`, the
docs page. New line, roughly: "Your Solana wallet signs every action. Mimir's relayer sends it to Arc and can only
move your USDC between your account, Mimir's market contract and your own Solana address."

## Open questions (decide before building)

1. **Audit:** `MimirV3` + `MimirAccount` + relayer before real USDC. Which auditor, and when?
2. **Limits:** per-position and per-day caps on the account, and who can raise them.
3. **Escape path:** if the relayer is down for good, how does a user get funds out? (e.g. a timelocked
   `ownerWithdrawToSolana` the owner can trigger for an account, still only to the bound address.)
4. **Gas sponsorship cost:** relayer gas on Arc for every bet + SOL for every withdrawal mint. Who pays at scale?

## Environments

Build and test on **Arc testnet + Solana devnet** (CCTP testnet: Solana devnet domain 5 ↔ Arc testnet domain 26)
until everything below passes. Only then: Arc mainnet + Solana mainnet, together. `main` (Solana devnet, the live
site) is untouched until the switch.

## Contract security, before anything holds real USDC

- **Review `MimirV3` first** against standard patterns (reentrancy and checks-effects-interactions, access control
  and timelocks, `msg.value` in `multicall`, fee and payout rounding so payouts never exceed the pot, the claim state
  machine, unbounded loops and griefing recipients, front-running around resolve/dispute, pause never blocking
  withdrawals, contract-balance-covers-liabilities). Fix what it finds, with a test per fix.
- **`MimirAccount`** gets the same treatment plus its own rules: relayer-only, no arbitrary call or transfer, one
  fixed CCTP recipient, on-chain caps, CREATE2 address bound to the Solana key, safe when `MimirV3` pays it.
- **Tests:** Foundry unit tests for every path, invariant/fuzz tests for the money (sum of balances and liabilities
  vs the contract's USDC), and a fork test against Arc testnet with real CCTP messages.
- **Static analysis:** Slither (and Aderyn if available) clean or every finding explained.
- **External audit** of both contracts and the relayer before mainnet.

## Security review of MimirV3 (2026-10-06)

`forge test`: 55/55 pass in the old repo; none covers a contract caller or the cases below. No critical findings.

| # | Severity | Where | Issue | Fix |
|---|---|---|---|---|
| 1 | High | `challengeClaim`, `createClaim`, `_payWinner` | Caller picks `agentOwnerRecipient`; a leaked relayer can collect agent fees or rig markets against accounts | MimirAccount pins it to `0`/allowlist; typed calls only (see above) |
| 2 | Medium | `refundExpired` vs `resolveClaim` / `resolveDispute` | After the grace period both are valid; a loser can front-run a late verdict with a refund | Verdicts revert after the grace period |
| 3 | Medium | `resolveDispute` | Pays the bond (`_settleBond`) while the claim is still `ST_DISPUTED`, so the payee can re-enter `refundExpired` and settle twice; only the 50k gas stipend stops it today | Set state before any transfer; `nonReentrant` on every state-changing function |
| 4 | Medium | `resolveDispute`, `transferOwnership` | The owner is the arbiter with no timelock on ownership; a compromised owner can dispute and rule for itself; a loser can stall via cheap disputes | Multisig arbiter, timelocked ownership, keep the bond if a dispute is never ruled on |
| 5 | Low | `_transfer` | Anyone can starve a recipient's 50k-gas payout so it is parked (no loss) | MimirAccount calls `withdraw()` to recover |
| 6 | Low | whole contract | No reentrancy guard; safety rests on ordering + the gas stipend | Add one |
| 7 | Low | `usdcPermit` | Permit front-running makes a multicall revert (ERC-20 mode only, not Arc) | try/catch + allowance check |
| 8 | Low | send helper | ERC-20 send to a code-less address counts as success | Only matters on a misconfigured deploy |

Sound: payouts never exceed the pot, fees never cut into a winner's stake, pause never blocks settlement or
withdrawals, `multicall` is non-payable and off in native mode. To check on Arc: whether Circle's blocklist applies to
native value transfers. Never deploy with `disputeWindow = 0` on mainnet.

### MimirAccount rules (from the review)

1. `receive()` accepts native USDC in well under 50k gas: no storage writes, no external calls.
2. Recovers parked funds only via MimirV3 `withdraw()` / `claimFees()` to itself; never exposes `withdrawTo` / `claimFeesTo`.
3. Every recipient field is fixed (`agentOwnerRecipient = 0` or allowlisted), never relayer input.
4. A typed allowlist of MimirV3 calls (`createClaim`, `createRematch`, `challengeClaim`, `disputeResolution`,
   `finalizeResolution`, `refundExpired`, `cancelClaim`, `withdraw`, `claimFees`); no raw call, no `multicall`, no
   `usdcPermit`; the MimirV3 address is immutable.
5. `msg.value` equals the stake (or exactly `MIN_STAKE` for a dispute bond), checked against the caps.
6. On-chain per-position and per-day caps, including dispute bonds.
7. Each action carries the user's intent hash and an on-chain nonce, so the relayer cannot replay or swap it.
8. `withdrawToSolana` burns only to the recipient set at creation, domain 5 hard-coded.
9. An escape path that does not need the relayer (timelocked, still only to the bound Solana address).
10. `nonReentrant` on every state-changing function.

## Phases

1. Security review of `MimirV3` and fixes; write `MimirAccount.sol` + tests; deploy both on **Arc testnet**; confirm
   the native-USDC/CCTP balance question.
2. Relayer + intent API; deposit and withdraw end to end, **Solana devnet ↔ Arc testnet**.
3. Port the oracle, council and indexer to Arc; point the UI at Arc (this branch's preview deploy, not the live site).
4. Rewrite the copy; external audit.
5. **Arc mainnet + Solana mainnet** together; switch the live site; then the showcase swap
   (`docs/TODO-arc-showcase.md`).
