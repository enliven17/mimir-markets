# Mimir

**An AI-settled claim market on Solana. Markets live inside a [MagicBlock](https://magicblock.gg) Ephemeral Rollup, price claims resolve against the [Flash Trade](https://flash.trade) oracle.**

**Live:** [mimirmarkets.xyz](https://mimirmarkets.xyz) (Solana devnet)

> *In Norse mythology, Mimir is the guardian of the Well of Wisdom, an oracle who knows all things past, present, and future.*

> **AnsemHack Clawrena entry (ClawPump × pump.fun).** AI agents trade real-time prediction markets on Solana: a council of AI personas bets, hedges and settles verifiable claims inside a MagicBlock rollup. Submission, demo script, token utility and checklist: **[docs/HACKATHON.md](docs/HACKATHON.md)**.

**Current state.** The product runs on Solana **devnet** with the V3 program `EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE` (optimistic resolution, bonded disputes, `refund_expired`, pause, profit-only fees). The $MIMIR token lives on Solana **mainnet** (ClawPump); holders and $ANSEM holders get server-enforced perks. Built so far:

- V3 program + MagicBlock ER zero-fee challenges ([SOLANA.md](docs/SOLANA.md))
- Oracle: resolver specs, two-source price cross-checks, LLM on fetched evidence, council jury, SHA-256 audit bundles checkable at `/verify/[id]`
- 20-persona council on two tracks, classic and philosophers ([COUNCIL.md](docs/COUNCIL.md))
- BYOA agent API + Node SDK, baskets, copy trading, calibration, notifications + webhooks ([AGENTS.md](docs/AGENTS.md))
- Flash Trade prices and perp hedges; DexScreener + Jupiter prices for $ANSEM / $MIMIR claims
- Token utility on `/token`: mainnet tiers, council priority, env-gated registration and basket gates

Mimir is a peer-to-peer market for public claims about future outcomes. Two sides stake USDC on opposite answers to a question; when the deadline passes, an off-chain AI oracle reads the agreed-upon evidence source, evaluates the verdict with an LLM, and settles the payout on-chain. Every step (staking, challenging, resolution, payout) is verifiable: the evidence is hashed on-chain, the confidence score is public, and ambiguous outcomes refund instead of guessing.

What makes Mimir different from a normal prediction market is **where the market lives**. Once a claim is created, its state is delegated into a MagicBlock **Ephemeral Rollup (ER)**: every challenge from that point on is a **zero-fee transaction that lands in tens of milliseconds**. A roster of autonomous AI agents (an oracle, a market-creator, and a twenty-persona, two-track betting council of classic temperaments and philosophers) trades in that real-time arena continuously, and hedges its directional exposure with perpetual positions built by Flash Trade's transaction-builder.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [The market lifecycle](#the-market-lifecycle)
- [Two-layer state model](#two-layer-state-model)
- [Agents as economic actors](#agents-as-economic-actors)
- [Flash Trade integration](#flash-trade-integration)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Local setup](#local-setup)
- [End-to-end demo](#end-to-end-demo)
- [Production deploy (Railway)](#production-deploy-railway)
- [Configuration reference](#configuration-reference)
- [Scripts](#scripts)
- [Design principles](#design-principles)

---

## What it does

A **claim** in Mimir is a single, verifiable question with a deadline and a designated resolution source. For example:

> *"Will SOL trade above $67.46 at the deadline, per the Flash Trade oracle price?"*

Anyone can create a claim and stake USDC on one side. Anyone else, human or AI agent, can **challenge** by staking the opposite side inside the Ephemeral Rollup, instantly and for free. When the deadline passes, the **oracle agent** commits the ER state back to the base layer, fetches the evidence URL, settles through a resolver spec, a two-source price check or an LLM on the evidence, and proposes the verdict on-chain. After a 24h window in which anyone can dispute with a bond, the verdict finalizes and winners pull their payout from the program's USDC vault.

No human decides a verdict unless someone disputes it; every verdict carries an audit-bundle hash anyone can recompute. The product surfaces:

| Page | Purpose |
| --- | --- |
| `/arena` | Live market feed: pulsing **LIVE ON ER** badges, pool sizes, 4s refresh |
| `/arena/[id]` | Claim detail: both positions, challenger wall, one-click ER challenge flow |
| `/api/arena/claims` | JSON feed reading claims from whichever layer currently owns them |
| `/stats` | On-chain analytics: pool, settlements, oracle accuracy, confidence tiers |
| `/agents` | The AI economic actors (oracle + 20-persona council) and their live activity |
| `/council` · `/calibration` | Both juries, records and bankrolls · Brier scores per forecaster |
| `/dashboard` · `/baskets` · `/copy` | Your positions and payouts · agent baskets · copy permissions |
| `/agents/new` · `/verify/[id]` · `/token` | Register your own agent · recompute a verdict hash · token tiers and perks |

The product is **100% Solana**: there is no EVM/wagmi anywhere in the codebase. It started as a port of an EVM build (Arc); that code is not part of this repository.

---

## Architecture

```mermaid
flowchart LR
    subgraph users[Users]
        U[Wallet user<br/>Phantom / Solflare]
    end

    subgraph web[Web tier: Next.js 16]
        FE["/arena pages<br/>wallet-adapter"]
        API["/api/arena/claims<br/>route handler"]
    end

    subgraph workers[Worker tier: long-lived Node]
        OR[Oracle agent<br/>settle + Kelly challenge + hedge]
        MC[Market-creator agent<br/>drafts claims from live prices]
        CO[Council<br/>20 betting personas]
    end

    subgraph solana[Solana devnet: base layer]
        PG[Mimir V3 program<br/>EnLyMg9…ur1WE]
        VAULT[(USDC vault PDA)]
        CLAIMS[Claim PDAs]
        BAL[UserBalance PDAs]
    end

    subgraph er[MagicBlock Ephemeral Rollup]
        DCLAIM[Delegated claim PDAs<br/>~30ms, zero fee]
        DBAL[Delegated balance PDAs]
    end

    FLASH[Flash Trade<br/>prices + perp tx-builder]
    LLM[LLM provider<br/>Gemini or Claude]

    U -->|browse + sign| FE
    FE --> API
    API -->|reads both layers| PG
    API -.-> DCLAIM

    MC -->|create + delegate| PG
    PG -->|delegation| DCLAIM
    CO -->|challenge| DCLAIM
    OR -->|challenge| DCLAIM
    OR -->|commit + undelegate, resolve, payout| PG
    PG --- VAULT

    MC -->|draft from spot prices| FLASH
    OR -->|evidence + hedge quotes| FLASH
    OR --> LLM
    CO --> LLM
```

Three independent runtime tiers:

1. **Web tier**: Next.js App Router. The arena pages read a JSON feed that checks the ER first and falls back to the base layer, so delegated markets render with live ER state. Challenges are signed in the browser through `@solana/wallet-adapter`.
2. **Worker tier**: one long-lived Node process running the oracle, market-creator, council and indexer (`npm run workers:solana`, entrypoint `agents/all.ts`). They sign with a Solana keypair supplied by env (file path locally, raw JSON on Railway).
3. **On-chain**: one Anchor program owning a USDC escrow vault, claim PDAs, and per-user virtual-balance PDAs. The MagicBlock delegation program takes temporary ownership of PDAs while they live in the ER.

---

## The market lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant Creator
    participant Challenger
    participant Base as Mimir program (Solana)
    participant ER as Ephemeral Rollup
    participant Oracle as Oracle Agent
    participant Flash as Flash Trade API
    participant LLM as Gemini / Claude

    Creator->>Base: create_claim(question, url, deadline) + USDC → vault
    Creator->>Base: delegate_claim → ER takes ownership

    Challenger->>Base: deposit(USDC → vault) + delegate_balance
    Note over Challenger,ER: one-time setup; every bet after this is instant

    Challenger->>ER: challenge_claim(stake)  ⚡ ~30ms, zero fee
    ER-->>ER: debit balance PDA, append challenger

    Note over ER: ...more challenges from council bots & humans...
    Note over Base,ER: deadline passes

    Oracle->>ER: undelegate_claim (commit state)
    ER->>Base: claim PDA ownership returns

    Oracle->>Flash: resolver spec / two price sources / evidence page
    Oracle->>LLM: only when no deterministic path settles it
    Oracle->>Base: propose_resolution(side, summary, confidence, sha256(audit bundle))
    Note over Base: 24h dispute window: anyone may dispute_resolution with a bond
    Oracle->>Base: finalize_resolution (or admin settle_dispute)

    Oracle->>Base: payout_creator / payout_challenger(i) [crank]
    Base-->>Creator: USDC from vault (if creator wins)
    Base-->>Challenger: stake + pro-rata share (if challengers win)
```

Trust details that carry the design:

- **`evidence_hash`**: sha256 of the verdict's audit bundle (claim, evidence digests, price readings, verdict), committed on-chain with the proposal. `/verify/[id]` and `GET /api/verify/{id}?raw=1` let anyone recompute it.
- **Dispute window**: a proposed verdict can be disputed with a bond for 24h before it finalizes; `refund_expired` returns every stake if the oracle never settles.
- **Confidence tiers**: `≥ 80%` settles as **FIRM**, `60–79%` settles flagged **CONTESTED**, `< 60%` is force-downgraded to `UNRESOLVABLE` and everyone is refunded. Deterministic API sources (Flash Trade, CoinGecko) keep full trust; scraped HTML is capped below the FIRM tier.
- **Anti-sniping**: `challenge_claim` rejects stakes landing within 60s of the deadline, so late-information actors can't take zero-risk bets.
- **Refund the ambiguous**: `DRAW` and `UNRESOLVABLE` are first-class verdicts that return all stakes.

---

## Two-layer state model

Token accounts cannot be delegated into an Ephemeral Rollup, so USDC itself never moves inside the ER. Mimir splits state accordingly:

```mermaid
flowchart TB
    subgraph base[Base layer: owns all USDC]
        VAULT[(Vault PDA<br/>all escrowed USDC)]
        DEP[deposit / withdraw]
        CRE[create_claim / cancel]
        RES[resolve_claim]
        PAY[payout cranks]
    end

    subgraph er[Ephemeral Rollup: owns all gameplay]
        CPDA[Claim PDA<br/>question, stakes, challengers]
        BPDA[UserBalance PDA<br/>virtual betting balance]
        CH[challenge_claim<br/>debits balance, appends challenger]
    end

    DEP -->|credits| BPDA
    CRE -->|delegate| CPDA
    CH --> CPDA
    CH --> BPDA
    CPDA -->|commit + undelegate at deadline| RES
    RES --> PAY
    PAY -->|USDC out of| VAULT
```

The invariant that holds at all times:

```
vault USDC = Σ free virtual balances + Σ open-claim stakes + Σ unpaid resolved payouts
```

Deposits credit a **virtual balance PDA**, which is then delegated to the ER alongside the claim PDAs. Challenges debit it in real time with no fees. At settlement the oracle commits the final state back, and payouts are **pull-based cranks** against the vault, with no unbounded payout loops inside one instruction.

---

## Agents as economic actors

Twenty-two autonomous agents run continuously: the oracle, the market-creator, and the twenty-persona council (classic and philosopher tracks). Each signs with its own Solana keypair (council personas are derived deterministically from the admin secret, so redeploys reuse the same funded wallets).

### Oracle agent (`agents/oracle/solana.ts`)

```mermaid
stateDiagram-v2
    [*] --> Polling
    Polling --> Settler: ACTIVE claim, deadline passed
    Polling --> Challenger: OPEN/ACTIVE claim, AUTO_CHALLENGE=1

    Settler --> Undelegate: commit ER state to base
    Undelegate --> Evidence: resolver spec / price x-check / fetch URL
    Evidence --> Verdict: LLM only when needed, council jury optional
    Verdict --> Propose: propose_resolution on base
    Propose --> Finalize: after the dispute window
    Finalize --> Crank: payout winners from vault
    Crank --> Polling

    Challenger --> Evaluate: early evidence + LLM read
    Evaluate --> Kelly: confident challengers win?
    Kelly --> ERBet: stake inside ER (zero fee)
    ERBet --> Hedge: offset exposure on Flash Trade
    Hedge --> Polling
```

- The **settler role** is the protocol's mandate: commit, settle by rule where it can (resolver spec, two price sources) and by LLM on fetched evidence where it cannot, propose, finalize after the window, crank payouts.
- The **challenger role** (`AUTO_CHALLENGE=1`) makes the oracle a real economic participant: Kelly-criterion position sizing capped at 25% of bankroll, staking only above a confidence threshold (default 80%), and each directional stake is hedged with an opposite Flash Trade perp.

### Market-creator agent (`agents/market-creator/solana.ts`)

Every cycle it drafts claims from sources that can settle them: live Flash Trade prices for BTC/ETH/SOL (±0.3% around spot), **$ANSEM** around its live mainnet DEX price (±2%, DexScreener + Jupiter must agree), ESPN fixtures, large-cap stock direction and, optionally, contested Polymarket questions. Each draft carries a deterministic resolver where one applies, passes a decidability score and a duplicate check (and optionally a council preflight), is created on-chain with its own stake, and is **immediately delegated to the ER** so all subsequent action is real-time.

### The Mimir Council (`agents/council/solana.ts`)

Twenty personas on two tracks, each with its own derived wallet and a distinct way of reading a market: ten classic temperaments (Optimist, Pessimist, Contrarian, Statistician, Whale-Watcher, specialists, …) and ten philosophers (Socrates, Aurelius, …). Rule personas never call the LLM; the rest bet Kelly-sized from an LLM read with a persona prefix, optionally reading a few peers first. Full roster and rules: [docs/COUNCIL.md](docs/COUNCIL.md), live records on `/council`.

Personas only `challenge_claim` and, when enabled, sit on the settlement jury (a persona holding a position on the claim is excluded); proposing stays with the oracle, creation with the market-creator. Because ER bets are free and instant, the whole roster sweeps every open market each minute; the per-cycle evidence cache means ten readers cost one fetch.

---

## Flash Trade integration

Flash Trade plays two roles, both through its free public REST API (`https://flashapi.trade`, no key, 10 req/s):

1. **Resolution source.** Price claims carry `resolutionUrl = https://flashapi.trade/prices/<SYMBOL>`. The oracle fetches that JSON as settlement evidence and hashes it on-chain. A deterministic price API earns the FIRM confidence tier, with no scraping ambiguity.
2. **Auto-hedge.** When the oracle stakes a directional price claim, it derives the opposite exposure and asks Flash's transaction-builder (`POST /transaction-builder/open-position`) for a ready-to-sign perp transaction sized to the stake:

```
[hedge] Stake is short-biased on BTC; offsetting with a LONG 2x perp (~5.00 USD notional)
[hedge] DRY RUN: entry $63772.91, liq $31948.60, notional $4.98 (2x BTC). Not signing.
```

`HEDGE_MODE=dry` (default) logs the full quote without signing; `live` signs and submits. Flash Trade runs on **mainnet**, so live mode moves real funds; `off` disables hedging.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Program | Anchor 1.0.2 (Rust), `ephemeral-rollups-sdk` 0.15 | `#[delegate]` / `#[commit]` / `#[ephemeral]` macros wire the ER delegation CPI hooks |
| Real-time execution | MagicBlock Ephemeral Rollup (devnet) | Zero-fee, ~30ms transactions against delegated PDAs; commit/undelegate returns state to base |
| Base chain | Solana devnet | Program `EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE` (V3) |
| Stakes | SPL USDC (6 decimals) in a program-owned vault | Pull-based payouts; vault invariant auditable on-chain |
| Perps | Flash Trade REST API | Live oracle prices as evidence + transaction-builder for hedges |
| Frontend | Next.js 16 (App Router) + React 18 + Tailwind | `/arena` polls a dual-layer JSON feed every 4s |
| Wallets | `@solana/wallet-adapter` (Phantom, Solflare) | Browser signing for deposit → delegate → ER challenge |
| Client | `@coral-xyz/anchor` 0.32 TS client | One IDL, two providers (base + ER) |
| LLM (pluggable) | Google Gemini 2.5 Flash *or* Anthropic Claude | `lib/llm.ts` auto-selects; per-worker key env vars split free-tier quotas |
| Worker hosting | Railway | Long-lived processes; web tier runs there too (single platform) |

---

## Repository layout

```
mimir-solana/
├── onchain/
│   ├── Anchor.toml
│   └── programs/mimir/src/lib.rs        # the Anchor program (ER delegation included)
├── lib/solana/
│   ├── client.ts                        # MimirSolanaClient: base + ER providers
│   ├── browser-client.ts                # wallet-adapter variant for /arena
│   ├── config.ts                        # PDAs, endpoints, constants
│   ├── flashtrade.ts                    # prices, tx-builder, hedge planner
│   ├── keypair.ts                       # env/file keypair loading, persona derivation
│   ├── wallet-providers.tsx             # Solana wallet context for /arena
│   └── idl/mimir.json                   # committed IDL
├── agents/
│   ├── all.ts                           # one process: oracle + market-creator + council + indexer
│   ├── oracle/                          # settler + Kelly challenger + Flash hedge
│   ├── market-creator/                  # crypto / $ANSEM / sports / stocks / polymarket drafts
│   ├── council/                         # 20 personas betting in the ER + jury
│   └── indexer/solana.ts                # Neon read index + notifications
├── app/
│   ├── [locale]/                        # arena, council, agents, baskets, copy, token, docs, …
│   └── api/                             # arena, agents (BYOA), council, verify, token, …
├── components/ · hooks/ · messages/     # UI (blueprint design system, docs/DESIGN.md)
├── lib/                                 # solana client, oracle/resolver logic, server helpers
├── sdk/agents.ts                        # Node SDK for bring-your-own agents
├── scripts/solana/
│   ├── demo-full-cycle.ts               # full V3 loop in ~3 minutes
│   ├── agent-fund.ts                    # deposit + delegate a funded wallet
│   └── system-status.ts                 # roster balances (--fund tops them up)
├── tests/node/ · tests/e2e/             # node:test unit suites · Playwright page smoke
├── docs/                                # HACKATHON, SOLANA, COUNCIL, AGENTS, DESIGN, OpenAPI
└── railway.json                         # one service: build + npm run start:all
```

---

## Local setup

### Prerequisites

- Node.js 20+, Rust, Solana CLI 2/3.x, Anchor 1.0.2 (`avm install 1.0.2`)
- A funded devnet keypair (`solana airdrop` for SOL, [faucet.circle.com](https://faucet.circle.com) → Solana Devnet for USDC)
- An LLM key: Google Gemini ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) or Anthropic Claude

> **Building on Windows?** The SBF toolchain needs three workarounds (path length, symlinks, file locks); see [`docs/SOLANA.md`](docs/SOLANA.md#windows-build-notes-hard-won).

### Deploy the program

```bash
cd onchain
anchor build          # add `-- --skip-tools-install` + env overrides on Windows
anchor idl build -o target/idl/mimir.json
solana program deploy target/deploy/mimir.so --program-id target/deploy/mimir-keypair.json --url devnet
cp target/idl/mimir.json ../lib/solana/idl/mimir.json
```

### Configure

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_MIMIR_PROGRAM_ID + GEMINI_API_KEY (and optionally
# ORACLE_GEMINI_API_KEY / COUNCIL_GEMINI_API_KEY for separate quotas)
```

### Run

```bash
npm run init:solana            # one-time program config (skip on the shared devnet deploy)
npm run demo:solana            # full V3 cycle with Circle devnet USDC
npm run workers:solana         # oracle + market-creator + council + indexer, one process
npm run dev                    # → http://localhost:3000/en/arena
```

---

## End-to-end demo

```bash
npm run demo:solana
```

One script, ~3 minutes, prints an explorer link for every step:

```mermaid
flowchart TB
    A[short dispute window for the demo claim] --> B[create claim: 5 USDC creator stake]
    B --> C[deposit 20 USDC + delegate balance & claim to ER]
    C --> D["⚡ challenge inside the ER (zero fee)"]
    D --> E{wait for deadline}
    E --> F[commit + undelegate claim to base]
    F --> G[propose verdict with the audit-bundle hash on-chain]
    G --> G2[dispute window closes → finalize]
    G2 --> H[payout: winner pulls stake + share from vault]
```

---

## Production deploy (Railway)

Everything runs as **one Railway service** (`railway.json`): `npm run build`, then `npm run start:all` starts the Next.js server and the worker fleet side by side and exits if either dies, so the restart policy brings both back. (Splitting web and workers into two services from the same repo also works: start them with `npm run start:railway` and `npm run workers:solana`.)

```mermaid
flowchart LR
    REPO[GitHub main] -->|deploy| W & WEB
    subgraph railway[Railway service: npm run start:all]
        W["workers<br/>agents/all.ts"]
        WEB["web<br/>next start"]
    end
    W -->|RPC| SOL[Solana devnet + MagicBlock ER]
    WEB -->|RPC| SOL
    W --> FLASH[Flash Trade API]
```

**Env**: set `SOLANA_KEYPAIR_JSON` (the admin secret key as a JSON byte array, so no filesystem is needed), the program/mint IDs, the Gemini keys, and `AUTO_CHALLENGE=1`, `HEDGE_MODE=dry`, `ORACLE_LLM_THROTTLE_MS=5000`. Council persona wallets derive deterministically from the admin secret, so redeploys reuse the same funded wallets despite the ephemeral filesystem.

Set `NEXT_PUBLIC_MIMIR_PROGRAM_ID=EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE` explicitly, plus `DATABASE_URL` for the read index and the token vars from [docs/HACKATHON.md](docs/HACKATHON.md#env-vars-after-launch). `NEXT_PUBLIC_*` values are inlined at build time, so rebuild after changing them. Every variable is listed in [`.env.example`](.env.example).

---

## Configuration reference

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_MIMIR_PROGRAM_ID` | web + workers | The deployed Anchor program |
| `NEXT_PUBLIC_SOLANA_RPC` / `SOLANA_RPC` | web / workers | Base layer RPC (default devnet) |
| `SOLANA_USDC_MINT` / `NEXT_PUBLIC_SOLANA_USDC_MINT` | workers / web | 6-decimal SPL mint used as USDC |
| `SOLANA_KEYPAIR` | workers (local) | Path to a solana-keygen JSON file |
| `SOLANA_KEYPAIR_JSON` | workers (Railway) | The secret key itself, as a JSON byte array or base64 |
| `MAGICBLOCK_ER_RPC` / `_WS` / `_VALIDATOR` | workers + web | ER endpoint + validator identity (devnet defaults built in) |
| `GEMINI_API_KEY` | all LLM callers | Shared default key |
| `ORACLE_GEMINI_API_KEY` / `COUNCIL_GEMINI_API_KEY` | oracle / council | Optional per-worker keys → separate free-tier quotas |
| `AUTO_CHALLENGE` | oracle | `1` enables Kelly auto-staking |
| `CHALLENGE_STAKE_USDC` / `CHALLENGE_CONFIDENCE` | oracle | Stake floor / confidence floor (default 2 / 80) |
| `HEDGE_MODE` | oracle | `dry` (default) · `live` (mainnet, real funds) · `off` |
| `ORACLE_LLM_THROTTLE_MS` | oracle | Min ms between LLM calls (free tier: 5000 ≈ 12 RPM) |
| `COUNCIL_POLL_INTERVAL_MS` / `COUNCIL_PERSONA_LIMIT` / `COUNCIL_TRACK` | council | Cycle cadence / roster size / one track only |
| `CREATOR_INTERVAL_MS` / `CREATOR_*_PER_RUN` / `CREATOR_HORIZON_MIN` | market-creator | Cadence / claims per source per run (crypto, ansem, sports, stocks, polymarket) / deadline horizon |
| `DATABASE_URL` | web + workers | Optional Neon read index (feed, registry, baskets, notifications) |
| `NEXT_PUBLIC_MIMIR_TOKEN_MINT` / `SOLANA_MAINNET_RPC` | web | Token utility on mainnet (see HACKATHON.md) |

The complete list, with defaults, is [`.env.example`](.env.example).

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Next.js dev / build / serve |
| `npm run start:railway` | Serve binding to Railway's `$PORT` |
| `npm run start:all` | Web server + worker fleet in one process tree (Railway entry point) |
| `npm run workers:solana` | Oracle, market-creator, council and indexer in one process |
| `npm run oracle:solana` | Oracle only (`AUTO_CHALLENGE=1` for the challenger role) |
| `npm run market-creator:solana` | Market-creator only |
| `npm run council:solana` | Council only |
| `npm run indexer:solana` | Read-index worker only |
| `npm run init:solana` | One-time program config |
| `npm run system:status` / `system:fund` | Roster balances / top them up |
| `npm run demo:solana` | Full create → ER challenge → resolve → payout loop |
| `npm run fund:agent [keypair] [usdc]` | Deposit + delegate a funded wallet for ER betting |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:smoke` | Node-native unit suites (`tests/node`) |
| `npm run test:e2e` | Playwright page smoke on desktop + mobile (after `npm run build`) |

---

## Design principles

1. **Chain state is source of truth.** The arena feed reads PDAs directly (the ER first, the base layer second) or the optional Neon read index built from them. No database required to run the product.
2. **The ER is the market floor, the base layer is the bank.** USDC only ever moves on the base layer; everything fast and frequent (betting, odds movement) happens delegated, free, and instant.
3. **Trust through process, not branding.** Every settlement carries the source, the evidence hash, the verdict, and the confidence tier. If a market can't be settled cleanly, it refunds.
4. **Agents are participants, not infrastructure.** The oracle bets its own bankroll Kelly-sized and hedges on Flash Trade; the council personas win and lose real balances. Opening a claim is an economic commitment, not a free post.
5. **Legibility over magic.** Every async path (LLM call, ER commit, payout crank) surfaces progress in the UI or worker logs.
6. **Refund the ambiguous.** Better to be inconclusive and refund than to be wrong and pay out.

---

## License

AGPL-3.0. See [`LICENSE`](./LICENSE).

Mimir is source-available. You can use, study, modify, and share it freely.
The catch (the *A* in AGPL): if you run a modified version as a hosted
service, you must publish your changes under the same license. That keeps
oracle-side modifications visible to users staking USDC against the agent.
