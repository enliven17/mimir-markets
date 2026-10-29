# October 26 product update

Implementation is prepared in this checkout. Deploy the backend and web build before publishing the announcement.
This document describes implemented behavior, including the boundaries of its performance and risk metrics.

## What changed

### 1. Public evidence before the token chart

Hosted agent pages expose 7/30/90-day **confirmed** execution evidence: realized native trading PnL, confirmed
execution counts, winning/losing exits, return on the cost of tokens sold, current open cost and explorer links.
Periods use recorded execution timestamps. The latest 10,000 executions within 90 days are included; truncation
is visible. Paused and killed agents remain in the hosted directory (bounded to 100 per status).

Public Arc records show outcome counts and still-open net stake separately, including for council wallets. Private
markets are excluded. These records are bounded to 300 indexed position rows. An outcome is not proof of payout
collection.

Return on closed cost is **not** portfolio return. Realized PnL drawdown is a decline in cumulative realized PnL,
expressed in SOL/ETH, not an equity percentage. Open cost is not a live mark. Fills include the executor's actual
debits/receipts; separate AI overhead, creator-fee income, funding flows and Arc outcomes are not folded into
trading PnL. Historical equity observations are not invented.

### 2. Copy controls shared by a follower's Solana subscriptions

The signed copy form stores one follower-wide policy:

| Control | Default |
|---|---|
| Maximum recorded cost in one token | 0.2 SOL |
| Maximum total open token cost | 1 SOL |
| Daily realized copy loss | 0.1 SOL |
| Realized copy PnL drawdown | 0.2 SOL |
| Maximum deviation from the leader's reference fill price | 3% |
| Maximum requested input / quoted pool liquidity | 0.1% |
| Platform aggregate spend ceiling / quoted liquidity, per leader signal | 1% |
| Maximum signal age | 2 minutes |

Amount limits can be disabled with zero. Price and liquidity checks remain bounded. The reservation mutation
rechecks the current policy, includes pending/unknown buys across subscriptions, and reserves the same maximum
debit the executor enforces: requested input + 5% + 0.02 SOL. It also reserves shared signal capacity. Proven
failures release reservations by job state; ambiguous signed buys hold them until the existing signature reconciler
settles them. Missing prices or liquidity skip new entries.

Copy sales now record actual receipts, proportional remaining cost and realized PnL once per signature. The
30-day copy total and agent trading total are shown together, with different capital and start dates stated.
Old unrecorded copy sales are not backfilled as zero-cost profits. The loss ledger starts from recorded exits after
this update. These are application controls on recorded costs/realized outcomes, not a guarantee against losses
or price changes. Arc copy stakes keep their existing independent per-stake USDC limits.

### 3. Strategy Lab

The Preview dashboard creates a paired forward trial from one owned preview agent. It needs two free slots and
counts against the existing three-agent allowance. Compare stop loss or minimum market edge; both variants get
fresh virtual balances and their own ledgers. Shared price snapshots and global AI budgets remain in force. No
historical replay or hypothetical retrospective return is presented.

New previews store a SHA-256 settings fingerprint, pinned preview model and revision. A child retains its
parent, trial and A/B label, and uses the parent's model even if the deployment default changes. Results stay attached to that immutable configuration. Live agents expose a fingerprint
of their current launch configuration; no live strategy-editing endpoint is introduced. Fingerprints are settings
identifiers, not on-chain attestations. Legacy previews are explicitly marked when a model was not recorded.

The existing Preview → Launch transfer still carries strategy rules, never paper funds/history. Its review now
calls out that the chosen live brain, real fills and funding differ from the paper run.

### 4. Radar and watchlists

`/radar` groups upcoming public markets by disagreement between the **latest explicit** direction for each
persona. Abstentions without a direction remain unknown. Forecast-only perspectives use a separate table from
staking decisions, and work with `COUNCIL_BETS=0`. Up to three compatible personas are considered per market.

The council uses its existing per-tick call ceiling; failed attempts count too. Non-house creators get the configured
daily attempt limit (default three) per UTC day, atomically claimed before model use. Forecast refresh defaults
to six hours. `COUNCIL_RADAR=0` restores the single-featured-take path. `COUNCIL_RADAR_REEVAL_MS` changes the
refresh interval, with a 30-minute floor. Existing comment/betting pause switches remain effective. Model/source
sharing is disclosed; the count is not presented as independent consensus.

Follow targets include a market, topic, agent forecasts/stakes or a recognized series. Writes require a fresh
wallet signature and replay checks; reads require that wallet's signed proof. No invite is needed just to save a
watchlist. Public responses never include follows. The in-app feed polls while visible and shows matching new
forecasts, side changes, evidence text hash changes, hosted-agent stakes and market state changes. Followed
individual markets add an imminent-deadline reminder. It is not background web push or an X/Telegram broadcast.

Each wallet can save 100 follows. The inbox reads a bounded 30-day feed, at most 500 candidate events and 50
displayed items. Signal cleanup prunes rows older than 31 days in batches. A changed evidence hash means the
fetched text changed; it is not an independent verification of that source.

### 5. Recurring market templates, timeline and onboarding

The Arena offers SOL/BTC daily checkpoint templates with a strict-above USD rule and 12:00 UTC deadline. When
less than ten minutes remain before noon, the template uses the next day. A recognized series requires its exact
question, source, resolver fragment, side labels, category and UTC deadline to agree. Follow events use that same
classification. The Arena links to a matching open pool before suggesting a new occurrence. Discovery is bounded
to indexed markets; this is not a global uniqueness constraint or an automatic funded-market scheduler.

The creation form requires an explicit threshold and an apply/review step. Users still sign and fund every market.
The resolution timeline uses on-chain dates and recorded proposal/dispute/final events; missing event times stay
unknown. Council predictions and the oracle proposal are distinct, and final outcome is distinct from collection.

The landing offers Preview, agent discovery and market participation as three entry points. Optional funnel events
reuse the existing PostHog singleton through its configured ingestion path. Added events are `mimir_visit`,
`preview_created`, `trial_created`, `live_agent_created`, `launch_funded`, `agent_launched`, `copy_started` and
`copy_funded`. They carry paper/live mode, chain or a coarse page category. No wallet, signature, amount or prompt
is added as a custom event property. Browser telemetry can be blocked, duplicated or cleared; it is not accounting.

In PostHog, build separate funnels for Preview creation → live agent creation → confirmed funding → launch, and
copy start → observed funded copy wallet. Measure browser retention by `mimir_visit` on day seven after first use.
Arc launches use their distinct USDC funding path and should not be mixed into the SOL/ETH funding funnel.

## Rollout

1. Review the additive Convex tables/indexes and generate bindings. `convex codegen` generates bindings; it is not
   the application deployment step.
2. Deploy the Convex schema/functions/crons to the intended deployment, then deploy the Next.js build. No new
   contract deployment, role change, token mint, live trade or fund movement is required by this update.
3. Keep current secrets and network settings. Configure `DEMO_ENABLED=1` on both backend and web only where
   Preview is intended. The preview model/AI key and existing PostHog settings retain their current owners.
4. Verify an empty record, a paused agent, a proven wallet's watchlist and a fresh paired trial
   against the target deployment. Inspect a copy's skipped reason without sending a real trade for verification.
5. Publish the prepared social package only after the changed routes work on the live domain.

Verification details are in [verification.md](verification.md). Announcement copy and six rendered assets are in
[`brand/product-update-2026-10/`](../../brand/product-update-2026-10/README.md).
