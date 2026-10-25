# Mimir Preview

The public product name is **Mimir Preview**. Existing internal `demo` API paths, tables and environment keys remain compatible.

Branch: `mimir-demo-feature`. Entry points: `/en/demo` and `/en/demo/new`. The Launch page, basket directory and
navigation link to Preview. Preview requires wallet verification, with no invite, deposit or token holding requirement.

`/en/launch` opens on the demo tab with five house strategies: Scout and Sentinel on Solana, Value and Matchday
on Arc, and Pioneer on Robinhood. Their public previews are available immediately; the backend seeds the five
paper agents once when enabled, then renews their lifetime without resetting their records. Wallet quotas remain
separate. The UI identifies the feature as **Mimir Preview · limited access**, with 3 free agents and 7 days of access.

Positive example charts are explicitly labelled **Illustrative example return** and calculated from curated
scenario paths in `lib/demo/showcase-samples.ts`. They never enter an agent's balances, ledger, P&L or current paper
performance. The current paper results and real quote-based activity are displayed separately.

After a verified wallet creates an agent, a popup explains how to go live. It also explains the exhausted allowance after
the third agent. **Deploy as a real agent** loads that wallet's own agent from the current session and opens live
Launch directly on the review step, preserving identity, thesis, avatar, chain, market rules and trading risk
settings. Virtual balances and trade history do not transfer. The existing invite/holder requirements, wallet
signatures, funding and token deployment flow still apply.

## Enable

1. Deploy the Convex schema and functions from this branch using the project's normal deployment process.
2. Set the same `MIMIR_LAUNCH_SECRET` (at least 16 characters) on Next.js and Convex, as for live launching.
3. Set `DEMO_ENABLED=1` on both Next.js and Convex.
4. Set `DEMO_GEMINI_API_KEY` on Convex. A separate key with its own provider spending limit is recommended.
   `DEMO_GEMINI_MODEL` defaults to `gemini-2.5-flash`; use a Gemini model that supports JSON output and
   `thinkingBudget: 0`. The key is never exposed to the browser or used for live trading or settlement.
5. Deploy the web app. New agents receive their first evaluation within a few minutes.

`DEMO_ENABLED=0` stops demo creation and processing. `MIMIR_BACKEND_OFF=1` also stops demo jobs. Turning processing
off freezes paper positions; it cannot create a real transaction. If the AI key is missing or its allowance is
exhausted, no new AI entries are made; existing positions still get their risk checks when fresh prices arrive.

## Limits

Defaults live in `lib/demo/types.ts`; they are enforced by Convex transactions, independently of browser state.

| Resource | Limit |
| --- | --- |
| Wallet preview lifetime | 7 days, fixed at session creation |
| Agents / baskets per wallet | 3 / 3, lifetime counts |
| Nonexpired demo agents across the deployment | 50, including the 5 house examples |
| New sessions per IP | 3 per day |
| New sessions / agents globally | 100 / 30 per hour |
| Agent evaluation | Every 5 minutes; up to 10 due agents each minute |
| External price snapshot | Shared across all sessions for 5 minutes |
| AI provider calls globally | 10 per UTC hour, 120 per UTC day |
| AI provider calls per agent | 6 per UTC day |
| House examples together | At most 4 calls/hour and 30/day, within the global ceilings |
| Candidates per AI request | At most 6 tokens or 6 markets |
| AI output / timeout | 1,024 tokens / 20 seconds |
| Provider retries / fallback keys | None |
| Open token positions per agent | 3 |
| Recent trade / event history | 100 each |

Token ranking and market judgement each reserve one AI call. Hard rules filter candidates before AI is requested.
Failures still consume the reserved call; HTTP refreshes, page views and status controls never invoke the AI.
This is a request/token ceiling, not a currency-denominated spending guarantee: provider prices vary. Configure a
provider-side monetary limit on the separate demo key for an additional spending ceiling.

## Behavior

- Creating and managing a preview requires a connected Solana wallet and a fresh message signature. Verification
  is offline and does not require a deposit or token holdings. Replayed sign-in signatures are rejected.
  The HttpOnly, SameSite cookie is scoped to `/api/demo` and cryptographically bound to the verified owner.
  Private reads and writes must match that wallet; legacy anonymous cookies grant no access. Convex stores the
  owner and token hash. Signing in again, switching browsers or clearing cookies preserves the same wallet's
  3-agent/3-basket allowance and original seven-day expiry. Owner addresses are not included in public examples.
- Launch shows linked cards only. Each house example has a public `/demo/showcase-<key>` detail page; private
  agents use `/demo/<id>` behind wallet verification. Strategy, performance, trades and controls live on those
  pages; `/demo` lists the connected wallet's agents and baskets.
- Launch also lists the verified connected wallet's own agents, refreshes on focus and hides them immediately
  on wallet disconnection. Its cards show actual paper returns rather than the house examples' illustrative returns.
- Detail pages share a visual trading desk: token selection, a sampled price chart with clickable buy/sell fills,
  open positions, a filtered trade table, performance cards and market position cards. Risk rules and logs are
  collapsed. Missing history is never fabricated: legacy previews initially show fill markers until quotes collect.
- The worker records existing shared-feed quotes for up to six held/recent tokens, retaining 144 points per token.
  Reused/stale timestamps are not re-stamped. Chart interaction makes no external API or AI calls. Directory
  responses omit price history; only the selected owned agent or single public house detail includes its history.
- LaunchWizard supplies the existing strategy and risk controls. Live and demo creation share the `Trading` and
  `Markets` validators. Demo reuses the live hard-entry, sizing, exit, market eligibility, Kelly sizing, token
  ranking prompts and market judgement prompts. Its AI transport makes exactly one bounded Gemini request per credit.
- Each agent starts with 10 virtual SOL or ETH for token trading and 1,000 virtual USDC for prediction markets.
  Arc agents use only the market sleeve. No funds can be withdrawn, deposited, bridged or copied to a real wallet.
- Solana uses the shared DexScreener sample. Robinhood uses the same Pons launch/graduated pool sources as live
  agents. Markets come from the existing public Arc index. Paid whale/social feeds are unavailable in the demo,
  explicitly shown in the wizard. Rules depending on missing metrics fail closed as in the live engine.
- Shared token feeds load only when a nonexpired demo agent has token trading enabled on that chain. Solana held
  tokens are additionally looked up in batches. Robinhood positions can only fill while a fresh quote is present
  in the sampled Pons pools. An unavailable quote leaves the position open and its last mark unchanged.
- Paper buys use the quote plus configured slippage; paper sells use the quote minus slippage. No gas or price
  impact from other demo agents is simulated. A missing or stale quote never produces a fabricated fill.
- Daily realized trading losses pause new entries. Paused agents still manage exits and market settlement. A
  shutdown closes positions at the next available fresh quote and cannot be resumed. Evaluation ends at expiry.
- Paper market stakes do not move real pool odds, volume, participant counts or positions. Public pool detail
  pages show a separate **Mimir Preview activity** section with agent names and virtual amounts, without guest credentials.
- Final real `resolved` / `cancelled` outcomes settle each paper stake once, while its session remains active.
  Proposed or disputed outcomes wait. Payouts use the final real pool plus this hypothetical stake and the standard
  0.5% entry fee. Refunds retain the entry fee, matching the live fee model. Expired demos freeze their last state.
- Demo baskets track the weighted returns of their members from composition time, starting at 1,000 virtual USDC.
  Trading and market sleeves have equal weight when both are enabled. Token equity includes marked open positions;
  unsettled market stakes stay valued at cost. Baskets do not create extra AI calls or real copy subscriptions.
- Each session's records are removed one day after expiry by bounded hourly cleanup. Histories are bounded even
  before cleanup. A backend transaction/version check prevents double fills and discards work if an owner pauses
  or shuts down the agent during its evaluation.

## Isolation and validation

All demo data lives in `demoSessions`, `demoAgents`, `demoStakes`, `demoBaskets` and `demoControl`. The paper worker
does not import any wallet creation, signer, transaction executor, fee payout or copy execution modules. The live
launch, token gates, live markets and real basket routes retain their existing authorization.

Node tests cover the real backend handlers against an indexed in-memory adapter, paper accounting, risk exits,
settlements, session ownership, quotas, concurrency/version checks and AI request ceilings. Browser tests exercise
the guest wizard and basket/controls on desktop and mobile using mocked demo HTTP responses. They do not deploy
Convex functions, send transactions or consume AI credits.
