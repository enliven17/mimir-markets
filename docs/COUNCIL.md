# The Mimir Council

**Twenty AI personas, two tracks, one take on every market.**

The council is a set of AI personas that read the markets on Arc. For every market, the persona best suited to it
writes a short **take** shown under the market: the side it leans to, how sure it is, and why. On testnet the
personas can also **bet**, each from its own Circle wallet on Arc; on mainnet betting is off and the council only
comments.

The point is disagreement, not one best trader: the Contrarian fights the crowd, the Whale-Watcher follows the
largest stake, Kahneman anchors on a base rate, Feynman refuses a claim it cannot explain.

## Contents

- [The two tracks](#the-two-tracks)
- [Takes](#takes)
- [Bets](#bets)
- [Wallets](#wallets)
- [Preflight](#preflight)
- [Where the council shows up](#where-the-council-shows-up)
- [Configuration](#configuration)
- [The Solana build](#the-solana-build)

## The two tracks

The roster is one list, [`agents/council/personas.ts`](../agents/council/personas.ts)
(`COUNCIL_PERSONAS` = classic first, then philosophers). Every consumer (the
worker, the jury, the APIs and the pages) reads it.

### Classic jury: ten temperaments

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
| 🗣️ The Yapper | Micro | 60% threshold, broad coverage, small stakes. | All |

### Philosopher jury: ten epistemic frames

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

`COUNCIL_TRACK=classic|philosopher` narrows the council to one track. Unset runs both.

Every bias prompt ends in *"Never invent evidence"* (a unit test enforces it).
The biases are style, not licence to hallucinate.

## Takes

Every 5 minutes the backend (`convex/arcCouncil.ts`) writes takes for open markets that have none yet, newest first,
up to `COUNCIL_TAKES_PER_TICK` (3) a run:

1. Pick the persona for the category: the specialist whose tags match (crypto, sports, weather), else the
   Statistician, else Socrates.
2. Fetch the market's source once (shared with any bets that run).
3. Ask the persona in **forecast** mode (`agents/council/shared/persona-llm.ts`): the outcome is in the future, so
   it picks the likelier side from what is known now (price against the threshold and the time left, form,
   standings, base rates) and gives a probability between 50 and 95, under 90 while real time or doubt remains. It
   answers "unresolvable" only when the question itself cannot be settled. Claim text and evidence are fenced as
   untrusted data.
4. Store the take (`arcMarketTakes`); the market page shows it.

**Spam guard:** a market creator gets at most `COUNCIL_TAKES_PER_CREATOR_DAY` (3) takes a day, so opening many cheap
markets cannot spend the backend's model quota. The house market creator is exempt. One take per market, written
once.

## Bets

Off when `COUNCIL_BETS=0` (mainnet). Otherwise, after the takes, each run looks at up to `COUNCIL_MAX_DECISIONS` (12)
(market, persona) pairs, closest deadline first, through the shared pipeline
(`agents/council/shared/persona-runner.ts`):

```
1. Skip: the persona's own market, already in it, a standing decision, betting about to close.
2. Specialists: the market's category must equal one of their tags.
3. Rule personas (Contrarian, Whale-Watcher): decide from the stakes, no model; they trade only the house
   creator's markets.
4. Model personas: cached evidence → fenced prompt → verdict. Agreeing with the creator, a draw or below the
   persona's minimum confidence → abstain. Disagreeing above it → bet.
5. Size with Kelly at the market's odds (capped at 15%, then 10% of the bankroll), cut to the VS room left
   (5× the creator's stake), and stake side B from the persona's Circle wallet.
```

A considered abstention stands for `COUNCIL_REEVAL_MS` (30 minutes); a model error is retried after 10. A stake
stands for good: a persona is in a market once. Every decision is recorded and shown on the market page.

## Wallets

Each persona bets from a Circle **developer-controlled** wallet on Arc; it signs through Circle's API with the
entity secret, so no persona key sits on Mimir's servers. `scripts/arc/council-wallets.ts` collects the existing
wallets, creates the missing ones, tops up any persona under the minimum from the richest wallet, and writes
`ARC_COUNCIL_WALLETS` (slug → `{id, address}`) for the backend.

## Preflight

[`agents/market-creator/council-preflight.ts`](../agents/market-creator/council-preflight.ts) lets a few personas
vet a **draft** market before it is published: clear, verifiable, balanced, settleable from its source? Each answers
`open | revise | skip` with a 0–100 score. Defaults to Socrates, Aurelius and the Statistician; advisory only.

- `POST /api/council/preflight`: 5 a minute per IP, 30 a minute per deploy; identical drafts cached 10 minutes.
- `MARKET_CREATOR_PREFLIGHT=1` makes the house market creator drop drafts averaging under
  `MARKET_CREATOR_PREFLIGHT_MIN_SCORE` (60).

## Where the council shows up

| Page | What it shows |
|---|---|
| `/arena/arc/<kind>/<id>` | The council's take on the market, and on testnet each persona's decision (staked, abstained) with its reasoning. |
| `/council` | Both tracks, each persona's Arc wallet and Solana identity, and their records. |
| `/agents` | Persona cards grouped by track, next to registered agents. |
| `GET /api/council/roster` | Both tracks: slug, name, bio, archetype, categories, minimum confidence. |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `COUNCIL_COMMENTS` | on | `0` stops takes. |
| `COUNCIL_BETS` | on | `0` stops bets (mainnet). |
| `COUNCIL_TAKES_PER_TICK` | 3 | Takes written per run. |
| `COUNCIL_TAKES_PER_CREATOR_DAY` | 3 | Takes per market creator a day (house creator exempt). |
| `COUNCIL_MAX_DECISIONS` | 12 | (market, persona) bet decisions per run. |
| `COUNCIL_REEVAL_MS` | 1800000 | How long a considered abstention stands. |
| `COUNCIL_LLM_THROTTLE_MS` | 4500 | Gap between model calls. |
| `COUNCIL_TRACK` | both | `classic` or `philosopher` only. |
| `COUNCIL_GEMINI_API_KEY` | shared keys | The council's own model key; it never uses the oracle's keys. |
| `ARC_COUNCIL_WALLETS` | | slug → Circle wallet, from `scripts/arc/council-wallets.ts`. |
| `COUNCIL_DRY_RUN` | off | Decide and record without staking. |
| `MIMIR_PAUSE_COUNCIL` | off | `1` skips whole runs. |

## The Solana build

Before Arc, the council ran as a long-lived worker on Solana devnet: keypairs derived from the admin key, zero-fee
challenges inside a MagicBlock rollup, a settlement jury the oracle could consult, and paid peer reads. None of that
runs on Arc; the Arc oracle settles without a jury. The persona roster, prompts, category rules and Kelly sizing were
kept. The old worker is `agents/council/solana.ts`; the program is described in
[archive/SOLANA.md](archive/SOLANA.md).
