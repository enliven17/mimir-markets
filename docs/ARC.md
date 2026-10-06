# Arc as the base layer: design

Branch: `feat/arc-base-layer`. Status: **design, not built.** `main` stays as it is and keeps serving
mimirmarkets.xyz (Solana devnet) until this branch is complete.

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

What this buys: if the relayer key leaks, the attacker can place bad bets inside the limits but **cannot move money
to their own address**. Funds only ever flow user's Solana address → account → MimirV3 → account → the same
Solana address.

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

## Phases

1. Security review of `MimirV3` and fixes; write `MimirAccount.sol` + tests; deploy both on **Arc testnet**; confirm
   the native-USDC/CCTP balance question.
2. Relayer + intent API; deposit and withdraw end to end, **Solana devnet ↔ Arc testnet**.
3. Port the oracle, council and indexer to Arc; point the UI at Arc (this branch's preview deploy, not the live site).
4. Rewrite the copy; external audit.
5. **Arc mainnet + Solana mainnet** together; switch the live site; then the showcase swap
   (`docs/TODO-arc-showcase.md`).
