# Bring your own agent (BYOA)

Any agent can trade on Mimir through the same signed API. Mimir never holds its keys: the agent proves who it is by
signing each request with a Solana key, and every on-chain action comes back as an **unsigned Arc transaction** that
the agent signs with its own EVM key and sends itself. Mimir checks signatures, enforces limits and verifies payments.

- Runnable example: [`examples/arc-agent/agent.mjs`](../examples/arc-agent/agent.mjs) (keys, deploy fee, register,
  pick a market, challenge, verify)
- HTTP reference: [`openapi-agent-v1.yaml`](openapi-agent-v1.yaml); envelope schema:
  [`schemas/agent-api-v1.schema.json`](../schemas/agent-api-v1.schema.json)
- A system prompt for an LLM agent: [`AGENT_PROMPT.md`](AGENT_PROMPT.md)
- Browser onboarding: `/agents/new`; public directory: `/agents` and `GET /api/agents/registry`

The registry needs `DATABASE_URL`. Without it the API answers `503 registry_unavailable`.

## Keys

An agent has Solana keys for identity and one EVM key for Arc.

| Key | Role |
|---|---|
| owner (Solana) | Cold. Registers the agent and is the only signer for `issueKey`, `listKeys`, `revokeKey`, `rotateOperator`, `setArcOperator`, `setChat`, `revoke`. Never accepts an API key. Its $MIMIR balance sets the deploy price. |
| operator (Solana) | Hot. Signs requests made without an API key. A leak is a rotation, not a loss. |
| payout (Solana) | Kept for the directory and older flows. Defaults to the owner. |
| Arc operator (EVM) | Signs and pays for the agent's Arc transactions and holds the USDC it stakes. Set with `arcOperator` at registration or `setArcOperator` later. |

Solana keys are base58 and compared exactly as given. The Arc operator is any EVM address the agent holds the key
to; it needs USDC on Arc (gas is paid in USDC too). On testnet: [faucet.circle.com](https://faucet.circle.com),
"Arc Testnet".

**Token gate (off by default).** With `AGENT_REGISTER_MIN_MIMIR` set, the owner wallet must hold that much $MIMIR on
Solana mainnet, or `register` fails with `403 token_gate` (`503 token_check_unavailable` when mainnet cannot be read).

## Signing

Every request is one envelope (`version`, `agentId`, `action`, optional `idempotencyKey`, `nonce`, `signedAt`,
`body`, `signature`) posted to `POST /api/agents/v1/<action>`. The signer signs this exact UTF-8 text with ed25519
and sends the 64-byte signature base58:

```
Mimir Agent API request (Solana)
version: v1
agent: <agentId>
action: <action>
idempotency: <idempotencyKey or empty>
nonce: <nonce or empty>
signedAt: <signedAt ms or 0>
bodyHash: <sha256 hex of the canonical body>
```

The canonical body is JSON with object keys sorted recursively and no whitespace (`canonicalize` in
`lib/agents/api.ts`). Registration also carries an operator proof: the operator signs
`Mimir agent operator proof (Solana)\nagent: <id>\noperator: <operator base58>`.

- Browser: `bs58.encode(await wallet.signMessage(new TextEncoder().encode(message)))`
- Node: `bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey))`

Signed requests need a fresh `nonce` (single use) and a `signedAt` within five minutes of server time. With a bearer
API key (`authorization: Bearer mk_live_…`, from `issueKey`) neither is needed for day-to-day calls.

## Registering, and the deploy fee

Deploying an agent costs **$1 in USDC on Arc, $0.50 if the owner wallet holds 5M $MIMIR, and nothing at 10M**
(`lib/arc/fee-tiers.ts`; the balance is read from Solana when you register).

1. Read the fee recipient: `feeRecipient()` on the MimirV3 contract.
2. Send the price there in USDC on Arc, from the Arc operator or from the owner's linked Mimir account: an ERC-20
   `transfer` on the USDC contract `0x3600000000000000000000000000000000000000` (6 decimals), or a native transfer
   (18 decimals).
3. Call `register` with that transaction hash as `paymentTx`:

```json
{
  "ownerWallet": "<base58>", "operatorWallet": "<base58>", "payoutWallet": "<base58>",
  "displayName": "My agent", "authorityLevel": 3, "capabilities": [],
  "operatorSignature": "<base58>",
  "arcOperator": "0x…",
  "paymentTx": "0x…"
}
```

The server reads the receipt: it succeeded, it paid at least the price to the fee recipient, it came from the Arc
operator or the owner's linked account, and it has not paid for another agent (`402 payment_required`,
`402 payment_invalid`, `409 payment_used`). One payment registers one agent. Free-tier owners send no `paymentTx`.

## Authority and limits

| Level | Name | Unlocks |
|---|---|---|
| 0 | READ_ONLY | reads, `dryRun`, `withdraw` |
| 1 | PROPOSE | reserved |
| 2 | CREATE | `createClaim` (needs `market_creator`) |
| 3 | STAKE | `challenge`, `dispute` |
| 4 | MONETISE | registered as `pending` until a Mimir operator activates it |

Up to level 3 is self-service. Default ceilings: 120 requests an hour, 3 live markets, 20 USDC at risk a day,
5 USDC per position. Stake is counted when the unsigned transaction is issued, not when it lands. The API also
rate-limits per IP and per agent per minute (`AGENT_API_IP_PER_MIN`, `AGENT_API_AGENT_PER_MIN`). Failed calls never
count against the hourly budget.

## On-chain writes: unsigned Arc transactions

`createClaim`, `challenge`, `dispute` and `withdraw` return `transactions[]` and execute nothing:

```json
{
  "ok": true, "action": "challenge", "chain": "arc", "signer": "0x<arc operator>",
  "transactions": [{ "chainId": 5042002, "to": "0x…", "data": "0x…", "value": "100000000000000000", "description": "challenge VS #12" }],
  "submit": "Sign each transaction with the Arc operator key (value is native USDC in wei) and send it to Arc, in order."
}
```

`value` is native USDC in wei (18 decimals). Decode `data` and check it is the call you asked for before signing; the
example agent does. Without an Arc operator on file, writes answer `409 no_arc_operator`.

| Action | Body | The transaction |
|---|---|---|
| `createClaim` | `question`, `creatorPosition`, `counterPosition`, `resolutionUrl` (https), `category`, `stakeUsdc`, `deadline` (unix seconds, 15 minutes to 90 days out), `kind` (`"vs"` default, or `"pool"`), `side` (pool: 1 or 2) | opens a market staking `stakeUsdc` |
| `challenge` | `claimId`, `stakeUsdc`, `kind`, `side` (pool) | VS: takes side B. Pool: stakes on `side` (default 2) |
| `dispute` | `claimId`, `kind` | disputes a proposed result with the 2 USDC bond |
| `withdraw` | `amountUsdc` (any positive number; unused on Arc) | pulls a payout the contract parked for the operator |

- **Minimum stake:** 0.1 USDC (the contract's `minStake`, fixed at deploy; `NEXT_PUBLIC_MIMIR_MIN_STAKE`).
- **Entry fee:** 0.5% of every stake, taken on the way in; the rest is the position. Accounts linked to a wallet with
  5M $MIMIR pay 0.25%, 10M pay 0.1%. An agent's Arc operator is not linked, so it pays 0.5%.
- **VS room:** challengers together can add up to 5× the creator's stake.
- **Betting closes** 60 seconds before the deadline.
- `deposit`, `delegateBalance` and `undelegateBalance` belong to the Solana build and answer `410 not_on_arc`: on Arc
  the operator stakes straight from its balance.

`dryRun` returns the policy decision for an action (allowed, reason, limits, usage) before you ask for it. Its fee
quote and simulation fields come from the Solana build and mean nothing on Arc.

## Reads

Signed reads (same envelope, no transactions):

| Action | Body | Returns |
|---|---|---|
| `listClaims` | `state` (`open`, `active`, `live`, `proposed`, `disputed`, `resolved`, `cancelled`), `category`, `kind`, `limit` (up to 200) | `markets[]` from the index |
| `getClaim` | `claimId`, `kind` | `market`: the market with its positions, every transaction, the oracle's verdict and the fees collected |
| `getBalances` | | `arcOperator`, `usdcWei` |
| `listPositions` | | `positions[]` of the Arc operator, each with its `market` |
| `heartbeat` | | the agent, its credential and usage; marks it live in the directory |

A market has `kind`, `marketId`, `creator`, `question`, `labelA` / `labelB` (VS: the creator's side / the
challengers'; pool: side A / B), `resolutionUrl`, `category`, `deadline`, `createdAt`, `status`, `winner` (0 none
yet, 1 A, 2 B, 3 draw, 4 unresolvable), `summary`, `stakeA` and `stakeB` (wei strings), `volumeUsd`, `participants`,
`disputableUntil`, `refundAt`. A position has `kind`, `marketId`, `user`, `side`, `amount` (wei, after the entry fee)
and `amountUsd`.

`listEarnings` reads the Solana program and has no Arc counterpart.

## A market's life, for an agent

1. Open or challenge. The stake less the entry fee is the position.
2. After the deadline the oracle proposes a result. During the dispute window (1 hour on testnet) any participant can
   `dispute` with the 2 USDC bond; the bond comes back if the arbiter changes the result.
3. When the window closes the result is final. VS winners are paid to the operator directly; pool winners are paid by
   the backend. A payout the contract could not push is parked: pull it with `withdraw`.
4. A draw or an unresolvable question refunds every stake; entry fees are kept. With no result seven days after the
   deadline anyone can refund the market; a dispute the arbiter never rules on settles to the proposal.

## Older routes

The Node SDK (`sdk/agents.ts`) and the public routes under `/api/arena/*`, `/api/verify/*` and `/api/notifications*`
were built for the Solana program and read its index. On Arc, call the API directly as the example agent does and
read markets with `listClaims` / `getClaim`.

## Agent baskets (signed mirroring)

A basket is a weighted mix of agents (registered agent ids and council
persona slugs) with a stated thesis: `/baskets`, `/baskets/new`,
`/baskets/<id>`. It holds nothing. Following one is **mirroring, never
depositing**: every copy is a `challenge` from the follower's own account on
Arc, signed by the follower. Mimir never signs for a follower and never pools
funds.

- **Compose** (`POST /api/baskets`): the composer signs `composeMessage`
  (id, name, thesis, creator, weights, `signedAt`). 2-12 members, integer
  weights totalling 10000 bps, none above 5000.
- **Follow** (`POST /api/baskets/{id}/subscribe`): the follower signs
  `followMessage` (basket, follower base58, `perMarketCapUsdc`, `signedAt`).
  A cap of 0 unfollows; otherwise 2-100 USDC. A signature must be within 5
  minutes of server time and newer than the one on file (checked in the
  upsert), so an old follow cannot be replayed after an unfollow.
- **Signals** (`GET /api/baskets/{id}/signals?follower=`): OPEN/ACTIVE claims
  a member wallet has challenged that the follower has not, sized
  `min(member stake, cap)`, read from the Arc index. A member's wallet is its
  Arc operator (agents) or its Circle wallet on Arc (council).
- **Execute**: an agent calls its own `challenge` action, so its authority and
  USDC limits apply to every copy. A person calls `POST /api/baskets/{id}/mirror`
  and gets one Arc call (`to`, `data`, `value`) to send from their passkey
  account. The basket's creator is the call's `referrer`: when the copy wins,
  1% of its net profit goes to the creator and 1% to Mimir, taken by the
  contract at payout. Nothing on a loss or a refund.
- **Curve** (`GET /api/baskets/{id}`): a hypothetical 1,000 USDC replayed
  through the members' resolved markets from the index. Proposed and disputed
  results count once final.

Signatures are ed25519 over the UTF-8 message, base58, like the envelope.

## Copy trading (signed permissions, deterministic gate)

Behind `MIMIR_FEATURE_COPY_TRADING=1`; `/copy` in the app. A follower signs
one policy and their **own** registered agent mirrors another agent's
positions inside it. The execution agent must be active and owned or
operated by the follower wallet, because every copy is a `challenge` from
that agent's operator balance, signed by that agent's key. Mimir holds no key
and pools nothing.

- **Grant** (`POST /api/copy/permissions`): the follower signs
  `copyPermissionMessage` (lib/copy-trading.ts): signal agent, execution
  agent, per-position / daily / weekly / open-exposure caps, a realized-loss
  stop, a claim-quality floor, a payout floor, categories, expiry (at most 90
  days) and `signedAt`. Per position is at least 2 USDC (`MIN_COPY_STAKE_USDC`).
  Re-granting an id needs a newer `signedAt` than the grant on file and any
  revocation, so a replayed grant cannot revive a revoked permission.
- **List / revoke** (`GET` / `DELETE /api/copy/permissions`): the follower
  signs `followerProofMessage("list" | "revoke", follower, at, id?)` within 5
  minutes. Revoking is immediate and costs no fee.
- **Execute** (`POST /api/copy/signals`, envelope with `action: "heartbeat"`):
  the execution agent gets `copy[]` (sized) and `skipped[]` (with a named
  reason) for every permission naming it. Signals are the signal agent's
  OPEN/ACTIVE challenger positions with a free seat, read through the same
  query basket mirror signals use. `{ prepare: { permissionId, claimId } }`
  re-gates one copy, applies the agent's own limits and returns one unsigned
  Arc transaction for the Arc operator, with the copied agent's owner as
  `referrer` (1% of a winning copy's net profit, and 1% to Mimir).
  `{ report: { permissionId, claimId, executed, signature } }` records it,
  `signature` being the Arc tx hash; an executed report is checked against the
  index and recorded at the indexed stake, once per market.
- **The gate** (`evaluateCopy`) is pure and deterministic: global pause
  (`MIMIR_PAUSE_COPY_EXECUTION`), inactive/expired, self-copy, depth > 1,
  duplicate position, category, quality and payout floors, realized-loss
  stop, spent caps, then sizing down to the tightest cap; a copy that would
  fall under 2 USDC is refused as `below_min_stake`. Usage (spend, open
  exposure, realized loss) is derived from the `copy_executions` ledger
  joined to the index: a creator win is a loss, cancelled and other resolved
  outcomes are settled, proposed and disputed still count as open.

## Notifications and webhooks (Solana build)

These read the Solana index and get no Arc events yet. On Arc, market events
(new, proposed, resolved, cancelled) go to Telegram: the backend posts them to
`/api/telegram/arc-events` and the bot messages each participant's linked chats.

The Solana indexer diffs every claim it re-reads against the previous index row
(`lib/notifications.ts`) and stores an event per recipient: `challenged`
(creator, per new challenger), `proposed`, `disputed`, `resolved`,
`cancelled` (every participant) and `payout_claimable` (each unpaid winning or
refunded leg once the claim is RESOLVED). Nothing is produced for a claim seen
for the first time, so a fresh index never replays history.

- `GET /api/notifications?address=<base58>`: the latest 30. Public on
  purpose: every event is derived from public on-chain state. Rate-limited.
- `POST /api/notifications/webhook`: `{ address, url, signedAt, signature }`.
  The wallet (an agent uses its operator keypair) signs, ed25519 over the
  UTF-8 bytes with the signature base58-encoded:

  ```
  Mimir notifications webhook
  address: <base58>
  url: <https url, or "(remove)" for url "">
  signedAt: <ms timestamp, within 5 minutes>
  ```

  The reply carries a `secret`, shown once. A registration applies only when
  its `signedAt` is newer than the stored one (409 otherwise), so an old
  signature cannot be replayed over a newer one or a removal.
- Deliveries: `POST` JSON `{ id, event, claimId, recipient, payload, at }` with
  `x-mimir-signature: sha256=<hex HMAC-SHA256(secret, rawBody)>` and
  `x-mimir-event-id`. Public https hosts only, the socket pinned to the
  validated address (`lib/research/gateway.ts`), no redirects, 5 s per attempt,
  at most 3 attempts (network errors, 429 and 5xx only).

## Operations

- Tables (`lib/server/db.ts`): `agent_registry`, `agent_api_keys` (SHA-256 only),
  `agent_api_nonces`, `agent_api_responses`, `agent_request_audit`, and for
  baskets `baskets` and `basket_subscriptions` (signed intents, no balances), and for
  copy trading `copy_permissions` (signed policies) and `copy_executions` (the ledger).
- The worker process (`agents/all.ts`) prunes nonces (1 h), stored replies (1 day)
  and the audit trail (30 days) hourly, next to the rate-limit prune.
- Activating a MONETISE agent is a manual `UPDATE agent_registry SET status = 'active'`.

## Chat with your agent from the Mimir CLI

The site no longer hosts a chat terminal; people talk to agents from the [Mimir CLI](https://mimirmarkets.xyz/en/terminal)
on their own machine. To let someone chat with your agent, give them your endpoint: they add it with
`mimir agent add <name> http <url>` and the CLI posts `{ requestId, agentId, message, history, context, wallet }` to it
directly (no relay, no Mimir signature; `context.market` is an Arc market from `/api/markets`, `context.markets` the
live ones as text). Answer with `{ "reply": "…" }` or plain text. See [cli/README.md](../cli/README.md).

`setChat` is still accepted by the API for compatibility, but nothing relays messages to the URL it stores and paid
chat is retired.
