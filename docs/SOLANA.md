# Mimir on Solana — program deep-dive & ops notes

The product story, architecture diagrams, and quickstart live in the
[README](../README.md). This document covers the on-chain program design,
deployed artifacts, and the build/deploy mechanics.

## Deployed artifacts (devnet)

| Thing | Value |
|---|---|
| Program (V3) | `EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE` |
| Legacy program (pre-V3, funds migrated out) | `J9MZfzQt2LVkdfvqvTRPhcSN41gSmGKDWNVjxUQPxSDR` — IDL kept at `scripts/solana/idl/mimir-v2.json` |
| USDC mint (Circle devnet, 6 dp) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` — fund wallets at faucet.circle.com |
| Admin = oracle = fee recipient | `J98R1EtNppvAFPXrviBUhFZbxoDpTCL7vjBwDRxVpKyk` |
| Initial policy | 50 bps platform + 50 bps agent-owner fee on profit, 24h dispute window, 7-day resolution grace |
| Base RPC | `https://api.devnet.solana.com` |
| ER RPC | `https://devnet-as.magicblock.app/` (router: `devnet-router.magicblock.app`) |
| ER validator | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| Program keypair | `onchain/target/deploy/mimir-keypair.json` (gitignored — upgrade authority; backups next to it as `mimir-v3-program-keypair.BACKUP.json` and at `~/.config/solana/mimir-v3-program-keypair.json`) |

## Program design

One Anchor program (`onchain/programs/mimir`, Anchor 1.0.2 +
ephemeral-rollups-sdk 0.15.3), split into `state.rs`, `math.rs` (pure fee +
payout arithmetic), `instructions/{admin,escrow,claim,resolution,payout,delegation}.rs`.
It is a port of the EVM `MimirV3.sol` to Solana's account model.

| Account | Seeds | Purpose |
|---|---|---|
| `Config` | `["config"]` | admin (+pending), oracle (+queued, eta), mint, pause, windows, live + queued fee policy, platform fee pool |
| `Vault` (token acct) | `["vault"]` | all escrowed USDC; authority = itself |
| `UserBalance` | `["balance", user]` | virtual betting balance; **delegated to the ER** |
| `Claim` | `["claim", id_le]` | question, stakes, challengers (max 16, each with an optional agent owner), frozen fee terms + windows, proposal/dispute/bond fields; **delegated to the ER while OPEN/ACTIVE** |
| `FeeBalance` | `["fees", owner]` | agent-owner fee accrual, pulled with `claim_agent_fees` |

### States

| # | State | Meaning |
|---|---|---|
| 0 | OPEN | created, no challengers yet |
| 1 | ACTIVE | at least one challenger |
| 2 | RESOLVED | final verdict in `winner_side`; payout cranks can run |
| 3 | CANCELLED | creator cancelled an OPEN claim |
| 4 | PROPOSED | oracle proposed `proposed_side`; disputable until `disputable_until` |
| 5 | DISPUTED | a participant posted the bond; the admin (arbiter) decides |

```
OPEN ──challenge──▶ ACTIVE ──propose (oracle, ≥ deadline)──▶ PROPOSED ──finalize (anyone, ≥ disputable_until)──▶ RESOLVED
  │                   │                                          └─dispute (participant + 2 USDC bond)──▶ DISPUTED ──settle_dispute (admin)──▶ RESOLVED
  └─cancel─▶ CANCELLED └── OPEN / ACTIVE / DISPUTED ── refund_expired (anyone, ≥ deadline|dispute + grace) ──▶ RESOLVED (UNRESOLVABLE)
```

A claim created while `dispute_window = 0` settles directly on `propose_resolution`
(MimirV3's `disputeWindow == 0` fast path). Sides: 0 NONE, 1 CREATOR,
2 CHALLENGERS, 3 DRAW, 4 UNRESOLVABLE.

### Instruction map

```
Governance (base layer):
  initialize(InitArgs)               oracle, fee recipient, fee bps, dispute window, grace
  set_paused(bool)                   admin — blocks create / challenge / propose only
  propose_admin → accept_admin       two-step admin transfer (zero key rejected)
  queue_oracle → execute_oracle      2-day timelock; execute is permissionless; cancel_oracle
  queue_fee_policy → execute_fee_policy   2-day timelock, ≤ 1000 bps total; cancel_fee_policy
  set_windows(dispute, grace)        admin — only claims created afterwards (terms are frozen per claim)
  withdraw_fees(amount)              admin or fee recipient → fee recipient's token account

Escrow (base layer, never paused):
  deposit / withdraw                 USDC ↔ vault, credits/debits UserBalance
  open_fee_account(owner)            permissionless; claim_agent_fees (owner pulls)

Claim lifecycle:
  create_claim(args{…, agent?})      USDC straight from the creator's ATA; snapshots fees + windows
  cancel_claim                       OPEN, no challengers
  challenge_claim(stake, agent?)     BOTH layers — zero-fee inside the ER; reads Config for the pause

Optimistic resolution (base layer, after undelegation):
  propose_resolution(side, summary, confidence, evidence_hash)   oracle-only, ≥ deadline
  dispute_resolution                 creator or challenger, before disputable_until, 2 USDC bond from their ATA
  finalize_resolution                permissionless, ≥ disputable_until
  settle_dispute(side, …)            admin (arbiter)
  refund_expired                     permissionless escape hatch
  refund_bond                        permissionless crank → disputer's ATA

Payouts (base layer, permissionless cranks):
  payout_creator / payout_challenger(i)   optional agent FeeBalance account when an agent fee is due

ER delegation hooks (ephemeral-rollups-sdk):
  delegate_claim (OPEN/ACTIVE only) / delegate_balance    base → ER
  undelegate_claim / undelegate_balance                   commit + return to base (permissionless)
```

### Disputes and the bond

The bond (2 USDC = `MIN_STAKE`, as in V3) comes from the disputer's **USDC
token account**, not the virtual balance: balances usually sit delegated in
the ER, while disputes run on the base layer against an undelegated claim, so
a balance debit would force an undelegate/redelegate round trip for every
dispute. If the arbiter changes the verdict (or there is no platform
recipient) the bond becomes `REFUND_DUE` and `refund_bond` returns it; if the
verdict stands it is forfeited into the platform fee pool. A DISPUTED claim
the arbiter never rules on is refundable `resolution_grace` after the
dispute, and the bond comes back.

### Fees (profit only)

Fee terms are frozen onto each claim at creation. For every payout leg:

```
profit       = max(gross − principal, 0)
platform_fee = profit × platform_fee_bps / 10_000   (waived if the recipient is the winner)
agent_fee    = profit × agent_fee_bps    / 10_000   (only if the position has an agent owner ≠ winner)
net          = gross − platform_fee − agent_fee     (≥ principal, always)

creator wins:     gross = creator_stake + Σ challenger stakes, principal = creator_stake
challenger wins:  gross = stake + stake × creator_stake / Σ stakes (rounded down), principal = stake
draw/unresolvable/refund: gross = principal → no fee
```

`platform_fee_bps + agent_fee_bps ≤ 1000` (10%). Platform fees accrue to
`Config.fees_accrued`; agent fees to the owner's `FeeBalance` PDA. Neither is
ever pushed, so a fee recipient can never block a payout. `lib/solana/fees.ts`
is the TypeScript twin (same test vectors as `math.rs`).

### Vault invariant

Token accounts can't be delegated into an Ephemeral Rollup, so USDC never
moves inside it. Deposits credit a virtual `UserBalance` PDA which *is*
delegated; `challenge_claim` mutates only delegated PDAs (balance + claim),
which is what makes it a zero-fee ~30ms ER transaction. At all times:

```
vault.amount ≥ Σ UserBalance.amount
             + Σ stakes of claims not yet settled (OPEN / ACTIVE / PROPOSED / DISPUTED)
             + Σ gross of unpaid legs of RESOLVED claims
             + Σ dispute bonds HELD or REFUND_DUE
             + Config.fees_accrued
             + Σ FeeBalance.amount
```

Every instruction moves value between these buckets, or in/out of the vault
by the same amount; pool-share rounding can only leave dust behind. The
LiteSVM suite asserts this after every settlement path.

### MimirV3 parity

| V3 feature | Solana program |
|---|---|
| Optimistic resolve + bonded dispute + arbiter | ✓ `propose/dispute/finalize/settle_dispute`, bond pull-refunded |
| `refundExpired` (7-day grace) | ✓ `refund_expired`; grace is per-claim (60s..30d, 7d default); also accepts OPEN claims |
| Pause (never blocks exits) | ✓ blocks create/challenge/**propose** (also stops the oracle), never withdraw/payout/refund/dispute |
| Two-step ownership, timelocked oracle | ✓ `propose_admin/accept_admin`, `queue/cancel/execute_oracle` (2 days) |
| Profit-only fees, cap, snapshot, timelock, pull accrual | ✓ |
| Events for admin actions | ✓ Anchor `emit!` on every governance, escrow and lifecycle instruction |
| Parked push payouts, `withdrawTo`, gas stipend | N/A — payouts are already pull cranks to the owner's token account |
| Permit, multicall | N/A (EVM-only); Solana transactions batch instructions natively |
| Rematch attribution, fixed odds, private claims, market types | N/A — not part of the Solana program |
| wins/losses counters | Off-chain (indexer) |

Deviation from V3: dispute/grace windows are admin-settable but frozen onto
each claim at creation, so a change never affects a market people already
entered (V3 has an immutable window and a constant grace).

### Tests

```bash
# host unit tests (math.rs)
cd onchain && CARGO_TARGET_DIR="C:\mimir-target" cargo test -p mimir --lib
# program integration tests in LiteSVM against the built .so (16 tests)
CARGO_TARGET_DIR="C:\mimir-target-tests" cargo test --manifest-path onchain/tests/litesvm/Cargo.toml
# devnet smoke: pause, ER challenge, propose→dispute→settle, propose→finalize, refund_expired, withdraw_fees
npx tsx --env-file-if-exists=.env.local scripts/solana/smoke-v3.ts
# full demo cycle (base → ER challenge → propose → finalize → payout)
npm run demo:solana
```

`solana-test-validator` can't run here (Windows symlink privilege), hence LiteSVM.

### Ops

- `scripts/solana/admin.ts status | pause | unpause | settle <id> <side> "<summary>" | withdraw-fees [usdc] | windows <d> <g>`
- The oracle worker proposes after the deadline, finalizes after the dispute
  window, cranks payouts and bond refunds, and runs `refund_expired` for
  claims stuck past their grace (`agents/oracle/lifecycle.ts`). It honors the
  on-chain pause. DISPUTED claims wait for `admin.ts settle`.
- `scripts/solana/migrate-v2-funds.ts [--execute]` moved balances out of the
  legacy program (see below).

### How the oracle decides (`agents/oracle/decide.ts`)

1. Evidence from the resolution URL. Sports claims wait up to 12h (and
   Polymarket-sourced ones 72h) for a final result.
2. Price claims read the price **at the deadline** from CoinGecko, Chainlink
   (mainnet `eth_call`, no key), Flash Trade (live only) and CoinMarketCap
   (with `CMC_API_KEY`).
3. A **structured resolver** settles from data alone when it is determinate.
   Claims have no settlement-rule field, so the spec rides in the resolution
   URL fragment, stored on chain with the claim:
   `https://flashapi.trade/prices/BTC#mimir=price:BTC:gt:83795.5` (json specs:
   `#mimir=json:eq:%22FINAL%22:data.status` read the URL itself). The market
   creator attaches one to its crypto claims; `/arena/create` offers it for
   Yes/No price drafts.
4. No evidence: retried for 6h, then proposed UNRESOLVABLE (refund).
5. The oracle's LLM verdict (never via the OpenRouter free router; the model is
   recorded), or with `COUNCIL_SETTLEMENT=1` the council jury — personas that
   hold a position are excluded; `COUNCIL_SELF_RESOLVING=1` runs the
   arXiv:2306.04305 sequential jury scored against an evidence-only reference.
6. Price cross-check: sources that disagree, or a model contradicting
   agreeing sources, refund; agreement adds confidence only for the side the
   data backs. Then fetcher-trust caps, tiers (<60 refund, 60–79 CONTESTED) and
   "oracle holds a position → FIRM only".

Everything is sealed into a canonical-JSON **verdict bundle**;
`evidence_hash = sha256(bundle)`, stored in `verdict_bundles` before the
proposal. `/verify/<id>` (and `/api/verify/<id>?raw=1`) recompute it —
`sha256sum` of the downloaded file must equal the on-chain hash. Every
pre-deadline forecast (oracle and personas) lands in `forecasts`;
`/calibration` shows Brier scores once claims resolve. `ORACLE_DRY_RUN=1`
decides and logs without writing anything.

### How the market creator drafts (`agents/market-creator/`)

Every draft is built by rule from a source that can settle it — no model
writes the question, threshold, date or URL:

| Source | Claim | Resolution URL | Deadline |
| --- | --- | --- | --- |
| Flash Trade (`crypto.ts`) | BTC/ETH/SOL above/below spot ±0.3% | `flashapi.trade/prices/<SYM>#mimir=price:…` | now + `CREATOR_HORIZON_MIN` |
| DexScreener + Jupiter (`ansem.ts`) | $ANSEM above/below its live mainnet price ±2% (`CREATOR_ANSEM_SKEW`), drafted only when both readers agree within 2% | `api.dexscreener.com/tokens/v1/solana/<mint>#mimir=price:ANSEM:…` (settles from DexScreener + Jupiter + CoinGecko) | now + `CREATOR_HORIZON_MIN` |
| ESPN (`sports.ts`) | "Will <home> beat <away> …?" for World Cup, Premier League, Champions League, NFL, NBA | that day's scoreboard + `&event=<id>` (the evidence fetcher narrows to the game) | kickoff (no betting on a known result) |
| stockanalysis.com (`stocks.ts`) | a large-cap closes above its previous close | the quote page | next NY close + 20 min |
| Polymarket (`polymarket.ts`, `MARKET_CREATOR_POLYMARKET=1`) | a live, 10–90% priced, liquid Yes/No market, restated with its close date | Gamma API record `?slug=` (rules, `closed`, UMA status) | the market's end date; the oracle waits up to 72h for UMA |

Then: the program's byte limits, a decidability floor (`lib/claimQuality.ts`,
`CREATOR_MIN_QUALITY`, default 60), a duplicate guard against joinable claims
and within the run (same category + normalised question or same source;
`dedupe.ts`), a cap on joinable claims (`MAX_ACTIVE_CLAIMS`), the optional
council preflight, and the USDC check. Each claim is created, staked and
delegated to the ER; the creator's expired unchallenged claims are cancelled
first. `MARKET_CREATOR_DRY_RUN=1` (or `--dry-run`, with `--once` for a single
cycle) drafts and logs without writing.

The same worker rebuilds the arena's **challenge opportunities** every 6h
(`lib/server/challenge-opportunities.ts`, table `challenge_opportunities`):
the best LLM-drafted candidate per source page, scored on decidability; one
that repeats a live claim links to it. Served by `GET /api/challenge-opportunities`
(curated seeds without a DB) and shown under the arena feed, behind
`NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS=1`.

### V2 → V3 migration (done 2026-09-28)

`scripts/solana/migrate-v2-funds.ts --execute` on the legacy program:

- 8 expired ACTIVE claims resolved UNRESOLVABLE (full refunds) and 26 unpaid
  payout legs cranked to participants' ATAs.
- 116.072526 USDC of council-persona virtual balances undelegated, withdrawn,
  deposited into V3 and re-delegated to the ER (optimist 12, pessimist 18,
  contrarian 2.07, statistician 2, whale-watcher 8, crypto-maxi 16,
  sports-pundit 20, weatherman 20, doomer 10, yapper 8). Admin had 0.
- Left in the legacy vault (26 USDC): 5 OPEN claims #263–#267 (3 USDC each)
  that only the market-creator `Ec5dpUvv…` can cancel, and balances of
  wallets outside the system. Re-run with `CREATOR_KEYPAIR_JSON` set to
  cancel those claims and move the creator's balance too.

## Railway deploy (single platform)

One service (`railway.json`): build `npm run build`, start `npm run start:all`,
which runs `next start -p $PORT` and the worker fleet (`agents/all.ts`:
oracle + market-creator + council + indexer) side by side and exits when
either dies, so the restart policy brings both back. The same variables as
below apply to that one service. (Two services from the same repo also work:
workers with `npm run workers:solana`, web with `npm run start:railway`.)

**Worker variables:**
- `DATABASE_URL` (Neon pooler) — the indexer mirrors on-chain claim state here
  and `/api/arena/*` reads from it. Optional: without it the feed falls back to
  reading the chain directly on every request.
- Variables:
  - `SOLANA_KEYPAIR_JSON` — the admin/oracle secret key as a JSON byte array
    (paste the contents of the keypair file); no filesystem needed
  - `CREATOR_KEYPAIR_JSON` — a separate wallet for the market-creator (paste
    `.keys/creator.json`). Without it the creator falls back to the admin
    key and the oracle will skip auto-challenging its claims (the program
    rejects self-challenges).
  - `NEXT_PUBLIC_MIMIR_PROGRAM_ID=EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE` (V3), `SOLANA_USDC_MINT`
  - `GEMINI_API_KEY`, `ORACLE_GEMINI_API_KEY`, `COUNCIL_GEMINI_API_KEY`
  - `AUTO_CHALLENGE=1`, `HEDGE_MODE=dry`, `ORACLE_LLM_THROTTLE_MS=5000`
- Council persona wallets are derived deterministically from the admin
  secret (sha256(admin ‖ slug)), so redeploys reuse the same funded wallets
  even though the container filesystem is wiped.

**Web variables:** `NEXT_PUBLIC_MIMIR_PROGRAM_ID` (inlined at build time:
rebuild after changing it), optionally `NEXT_PUBLIC_SOLANA_USDC_MINT`, and the
token vars from [HACKATHON.md](HACKATHON.md#env-vars-after-launch). The API
routes run as normal Node routes, no serverless timeout concerns.
`/api/health` reports each worker's heartbeat and the active pause switches.

Mark `SOLANA_KEYPAIR_JSON` as sealed: it carries the admin + oracle
authority in one key. USDC funding is external — top wallets up at
https://faucet.circle.com (Solana Devnet), then `npm run system:fund`
sweeps bettor balances into the ER.

## Windows build notes (hard-won)

The Solana toolchain fights Windows in four specific ways; the working
invocation is:

```bash
cd onchain
SBF_SDK_PATH="C:\sbf-sdk" CARGO_TARGET_DIR="C:\mimir-target" anchor build -- --skip-tools-install
CARGO_TARGET_DIR="C:\mimir-target" anchor idl build -o target/idl/mimir.json
cp /c/mimir-target/deploy/mimir.so target/deploy/   # then: solana program deploy
```

1. **platform-tools install fails** (os error 183/1314): the installer wants
   a symlink, which needs Developer Mode. Fix: extract the platform-tools
   tarball manually into the SDK's `dependencies/platform-tools` dir and
   build with `--skip-tools-install`.
2. **LNK1104 on rlibs**: the default SDK path exceeds Windows' 260-char
   MAX_PATH. Fix: copy the SDK to a short path and set
   `SBF_SDK_PATH=C:\sbf-sdk`.
3. **os error 32 (file locked)**: rust-analyzer in VS Code locks
   `onchain/target`. Fix: build with `CARGO_TARGET_DIR=C:\mimir-target`.
4. `--skip-tools-install` leaks into the IDL `cargo test` invocation and
   breaks it — generate the IDL separately with `anchor idl build`.

Also note: anchor-lang 1.0 changed `CpiContext::new` to take a `Pubkey`
program id (not `AccountInfo`), and `@coral-xyz/anchor`'s ESM build doesn't
export `Wallet` — the local `KeypairWallet` in `lib/solana/client.ts` exists
because Turbopack bundles the ESM build.
