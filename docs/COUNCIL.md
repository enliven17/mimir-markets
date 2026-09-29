# The Mimir Council

**Two juries. Twenty AI personas. Twenty derived Solana wallets. One real-time prediction market.**

The council is a set of autonomous AI personas that read the same on-chain
claims and stake real (devnet) USDC on them, each from its own wallet. Every
stake is a zero-fee `challenge_claim` inside the MagicBlock Ephemeral Rollup.
After the deadline the same personas can sit on the oracle's settlement jury,
except on claims they hold a position in.

The point is disagreement, not a single best trader. Where one persona stakes,
another abstains; where the Contrarian fights the crowd, the Whale-Watcher
copies it; where Kahneman anchors on a base rate, Feynman refuses a claim it
cannot explain.

---

## Contents

- [The two tracks](#the-two-tracks)
- [Wallets and funding](#wallets-and-funding)
- [Runtime](#runtime)
- [Decision pipeline](#decision-pipeline)
- [Stake sizing](#stake-sizing)
- [The settlement jury](#the-settlement-jury)
- [Preflight](#preflight)
- [APIs](#apis)
- [Where the council shows up in the UI](#where-the-council-shows-up-in-the-ui)
- [Running it](#running-it)
- [Configuration reference](#configuration-reference)
- [What changed from the EVM build](#what-changed-from-the-evm-build)

---

## The two tracks

The roster is one list, [`agents/council/personas.ts`](../agents/council/personas.ts)
(`COUNCIL_PERSONAS` = classic first, then philosophers). Every consumer — the
worker, the jury, the APIs and the pages — reads it.

### Classic jury — ten temperaments

| Persona | Archetype | Strategy | Categories |
|---|---|---|---|
| 🌞 The Optimist | LLM-biased | Leans affirmative on balanced evidence, +5% on plausible calls. | All |
| 🌧️ The Pessimist | LLM-biased | Mirror image: failure / regression reads when balanced. | All |
| 🔁 The Contrarian | Rule (no LLM) | Stakes when the creator holds ≥ 60% of the pot and someone has already challenged. | All |
| 📊 The Statistician | LLM-biased | Stakes only at ≥ 90% confidence; larger base stake. | All |
| 🐋 The Whale-Watcher | Rule (no LLM) | Stakes when the largest single stake is a challenger's; sits out a creator whale. | All |
| ₿ Crypto Maximalist | Specialist | `crypto` / `defi` / `token` only; bullish on adoption. | Crypto |
| 🏈 Sports Pundit | Specialist | `sports` / `soccer` / `nba` / `nfl` / `tennis` / `f1` only. | Sports |
| 🌤️ The Weatherman | Specialist | `weather` / `climate` only; numbers over narratives. | Weather |
| 💀 The Doomer | LLM-biased | Worst case is the base case, +7% on disaster reads. | All |
| 🗣️ The Yapper | Micro | 60% threshold, broad coverage (program minimum stake). | All |

### Philosopher jury — ten epistemic frames

[`agents/council/philosophers.ts`](../agents/council/philosophers.ts). They
disagree about *what counts as knowing*, which produces genuinely different
readings of the same evidence. All are LLM personas; each prompt tells it when
to abstain.

| Persona | Frame | Min confidence |
|---|---|---|
| 🏛️ Socrates | Is the question well-posed at all? Abstains on ambiguity. | 85 |
| 🎲 Kahneman | Outside view first: base rate, then update. | 78 |
| 🦢 Taleb | Prices the tail; a quiet record is not proof of stability. | 80 |
| 🔬 Feynman | Demands a mechanism it can state plainly. | 80 |
| 🪞 Munger | Inverts; weights sources by their incentives. | 80 |
| ⚙️ Ada | Reduces the claim to arithmetic, or says it can't be. | 82 |
| 🕸️ Meadows | Reads the feedback loop behind the number. | 78 |
| 🎭 Machiavelli | Announcements are moves; weights revealed behaviour. | 76 |
| 🪨 Aurelius | Rules only on what the named source can settle. | 84 |
| ☯️ Lao Tzu | Expects reversion from extremes. | 74 |

`COUNCIL_TRACK=classic|philosopher` narrows both the staking worker and the
settlement jury to one track (twenty personas is a lot of LLM calls on a free
tier). Unset runs both.

Every bias prompt ends in *"Never invent evidence"* (a unit test enforces it).
The biases are style, not licence to hallucinate.

---

## Wallets and funding

Each persona signs with a keypair derived from the admin secret:
`sha256(adminSecret ‖ "mimir-council:<slug>")` → ed25519 seed
([`lib/solana/keypair.ts`](../lib/solana/keypair.ts) `derivePersonaKeypair`).
Stateless — it survives ephemeral container filesystems. A local
`.keys/council/<slug>.json` wins when present. Adding the philosopher track did
not change any classic address (same seed per slug).

Devnet USDC is Circle's faucet mint (no mint authority), so **nothing mints**.
The classic ten were funded from the V2 → V3 migration
([`scripts/solana/migrate-v2-funds.ts`](../scripts/solana/migrate-v2-funds.ts),
classic only). The philosophers start empty:

```bash
npm run system:status   # every wallet: SOL, token account, ER balance, and the USDC shortfall per wallet
npm run system:fund     # tops up SOL from the admin, sweeps any token-account USDC into the vault + ER
```

`system:status` ends with a shortfall list (target 25 USDC per persona) — send
that much from the faucet or another wallet to each philosopher address, then
run `system:fund` (or just let the worker's next cycle sweep it). A persona
with an empty ER balance sits out staking but still sits on the jury (jurors
don't stake).

The worker rebalances every cycle: winnings, refunds and jury bonuses land in
the token account, so when a persona's ER balance falls under 2 USDC it
undelegates, deposits the token account into the vault and re-delegates.

---

## Runtime

```
agents/council/
  personas.ts          roster, tracks, COUNCIL_TRACK filter (client-safe)
  philosophers.ts      the philosopher track
  solana.ts            the worker: funding, cycle, dry run
  shared/
    types.ts           CouncilClaim, PersonaDecision
    evidence-cache.ts  one resolution-URL fetch per claim per cycle
    persona-rules.ts   Contrarian, Whale-Watcher, exact category match, Kelly sizing (pure)
    persona-llm.ts     fenced persona prompt, forecast / judge modes, strict parsing
    peer-reasoning.ts  in-process board of this cycle's takes (opt-in peer reads)
    persona-runner.ts  decide → size → stake in the ER
```

Each cycle:

1. Skip entirely when `MIMIR_PAUSE_COUNCIL_WORKER` (the heartbeat wrapper) or
   `MIMIR_PAUSE_STAKE` is set, or the program is paused on chain.
2. Rebalance persona funds (above).
3. Read joinable claims (OPEN / ACTIVE, deadline > 90s away), closest deadline
   first, at most `COUNCIL_MAX_CLAIMS`.
4. For every (claim, persona): run the pipeline below. One evidence fetch per
   claim, shared by all personas; LLM calls are serialised with a
   `COUNCIL_LLM_THROTTLE_MS` gap and use `COUNCIL_GEMINI_API_KEY` (its own
   free-tier bucket).

A considered LLM abstention is remembered for `COUNCIL_REEVAL_MS` (default
30 min) so the council doesn't re-ask the model every minute. An LLM error,
an unparseable reply or missing evidence is **not** remembered: the next cycle
asks again. Rule personas are never remembered (the pool keeps moving).

---

## Decision pipeline

```
1. Skip: own claim, already a challenger, claim full, ER bankroll < 2× base stake.
2. Specialists: claim category must EQUAL one of their tags (case-insensitive).
   Substring matching let a persona trade a claim it would then refuse to judge.
3. Rule personas (Contrarian, Whale-Watcher): decide from the pool, no LLM.
4. LLM personas: cached evidence → fenced prompt (claim, evidence and any peer
   reads are <untrusted> blocks) → verdict JSON.
   - every verdict is logged to /calibration (lib/server/forecasts.ts), staked or not
   - CREATOR_WINS → abstain (a persona can only join the challengers)
   - CHALLENGERS_WIN below the persona's minConfidence, DRAW, UNRESOLVABLE → abstain
   - CHALLENGERS_WIN at/above the threshold → stake
5. Size the stake (below) and send challenge_claim in the ER.
```

Peer reads (`COUNCIL_PEER_READS=1`): a persona sees up to
`COUNCIL_PEER_READS_PER_PERSONA` explanations other personas gave on the same
claim earlier in the cycle, fenced as untrusted opinions. The source build
bought these over x402 from `/api/council/reasoning`; here they are free and in
process. Off by default: it makes forecasts less independent, which blunts the
calibration scores.

---

## Stake sizing

[`persona-rules.ts`](../agents/council/shared/persona-rules.ts) `sizeStakeUnits`:

- base = max(spec `stakeUsdc`, program minimum 2 USDC)
- the ER bankroll must hold ≥ 2 × base, or the persona skips the claim
- LLM personas: Kelly at even odds on the confidence (`lib/kelly.ts`), capped
  at 15%, then at 10% of the bankroll, never below base, rounded down to cents
- rule personas stake base

---

## The settlement jury

With `COUNCIL_SETTLEMENT=1` the oracle asks the council for a verdict during
settlement ([`agents/oracle/council-vote.ts`](../agents/oracle/council-vote.ts)).
Jurors are every persona with a bias prompt from the active track(s),
specialists only in their exact category, and **never a persona holding a
position in that claim**. Each juror answers through the same persona prompt
in `judge` mode: its character sets the voice of the explanation, never the
verdict; temperature 0, no anonymous free-router fallback, the oracle's own key
and throttle. A juror that errors abstains; below `COUNCIL_QUORUM` decisive
votes the oracle settles solo. Self-resolving mode, cross-entropy scores and
USDC bonuses are described in [`SOLANA.md`](./SOLANA.md) (oracle decision order) and the jury's header.

---

## Preflight

[`agents/market-creator/council-preflight.ts`](../agents/market-creator/council-preflight.ts)
lets a few personas vet a **draft** claim before it is published: is it clear,
verifiable, balanced, and can the source settle it? Each answers
`open | revise | skip` with a 0–100 score. Defaults to Socrates, Aurelius and
the Statistician. Advisory only.

- `/arena/create` has an optional **Ask the council** check in the sidebar.
- `MARKET_CREATOR_PREFLIGHT=1` makes the market-creator vet its own drafts and
  drop those averaging under `MARKET_CREATOR_PREFLIGHT_MIN_SCORE` (default 60)
  or where skips outnumber open + revise. An unavailable council keeps the draft.

---

## APIs

All free (the source gated them behind x402 nanopayments) and therefore
rate-limited; errors never echo upstream or RPC text.

| Route | What | Limits |
|---|---|---|
| `GET /api/council/roster` | Both tracks: slug, name, emoji, bio, archetype, track, categories, derived address, min confidence, base stake. | CDN-cached 5 min |
| `GET /api/council/reasoning?claimId=&persona=` | One persona's in-character take on a claim. Rule personas return their rule read of the live pool (no LLM). | 30/min/IP; LLM misses 6/min/IP and 60/min per deploy; generations cached 10 min per (claim, persona) in `lib/server/reasoning-cache.ts` |
| `POST /api/council/preflight` | Draft vetting (body: question, creatorPosition, counterPosition, resolutionUrl, category?, settlementRule?, deadlineHours?, personas?[] up to 5). | 5/min/IP, 30/min per deploy; identical drafts cached 10 min |
| `GET /api/arena/[id]/council` | Where each persona stands on one claim (on-chain challenger list). | 30/min/IP |

Token holders with a holder proof (`x-mimir-wallet` + `x-mimir-proof`, `lib/token-proof.ts`) are counted per wallet at 2x / 4x / 8x these per-caller limits by tier, on their own deploy-wide pool (`lib/server/holder.ts`).

**Not ported: `/api/council/vote`.** In the source it existed so the oracle
could *buy* each juror's verdict over x402. Here the jury runs in process in
the oracle, with the staked-persona exclusion applied against the live
challenger list. A free public judge endpoint would have no consumer, carry no
settlement weight, and let anyone trigger judge-mode LLM calls plus evidence
fetches. Subscription passes (x402-pass) are out of scope for the same reason.

---

## Where the council shows up in the UI

| Page | What it shows |
|---|---|
| `/council` | Both juries: per-persona bankroll (ER + token account), stakes, USDC at risk (unsettled claims, including PROPOSED / DISPUTED), won / lost record, last three bets. Server-rendered per request; the scan is cached 30s ([`lib/server/council-stats.ts`](../lib/server/council-stats.ts)). |
| `/agents` | Live (5s poll) persona cards grouped by track, the oracle strip and registered third-party agents. |
| `/arena/[id]` | Council panel, grouped by track: who staked, how much, and won / lost / refunded once resolved. |
| `/arena/create` | Optional council preflight of the draft. |
| `/calibration` | Brier scores for every persona that forecast (both tracks) and the oracle. |

---

## Running it

```bash
npm run council:solana                         # the worker alone
npm run council:solana -- --dry-run --once     # decide and log one cycle: no funding, stakes or forecast rows
npm run workers:solana                         # oracle + market-creator + council + indexer in one process
```

---

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `SOLANA_KEYPAIR[_JSON]` | — | Admin key: persona keys derive from it; pays persona SOL fees. |
| `COUNCIL_GEMINI_API_KEY` | `GEMINI_API_KEY` | The council's own LLM key (worker, reasoning, preflight). |
| `COUNCIL_TRACK` | both | `classic` or `philosopher`: one jury only, for staking and settlement. |
| `COUNCIL_POLL_INTERVAL_MS` | 60000 | Cycle interval. |
| `COUNCIL_MAX_CLAIMS` | 12 | Claims per cycle, closest deadline first. |
| `COUNCIL_LLM_THROTTLE_MS` | 4500 | Serial gap between LLM calls. |
| `COUNCIL_REEVAL_MS` | 1800000 | How long a considered LLM abstention stands. |
| `COUNCIL_PERSONA_LIMIT` | all | First N active personas only. |
| `COUNCIL_PEER_READS` / `_PER_PERSONA` | off / 2 | In-process peer reads. |
| `COUNCIL_DRY_RUN` | off | Same as `--dry-run`. |
| `MIMIR_PAUSE_COUNCIL_WORKER`, `MIMIR_PAUSE_STAKE` | off | Skip whole cycles / just the staking sweep. |
| `COUNCIL_SETTLEMENT`, `COUNCIL_SELF_RESOLVING`, `COUNCIL_QUORUM`, `COUNCIL_ALPHA`, `COUNCIL_BONUS_USDC` | — | Settlement jury (oracle). |
| `MARKET_CREATOR_PREFLIGHT`, `_MIN_SCORE`, `_PERSONAS` | off, 60, socrates,aurelius,statistician | Market-creator draft vetting. |

---

## What changed from the EVM build

The source (Arc / Base / Arbitrum) council signed through Circle W3S wallets,
one per persona per chain, bought peer reads and settlement votes over x402,
and ran one cycle per chain. On Solana: derived keypairs, ER stakes, one chain,
in-process peer reads and jury, free rate-limited APIs. The decision rules,
the exact category match, the fenced prompts, Kelly sizing and the philosopher
track are ported as-is.
