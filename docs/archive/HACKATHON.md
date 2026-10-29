# Mimir at AnsemHack Clawrena

**Track:** AnsemHack Clawrena (also considered for Overall Winner) ·
**Live:** [mimirmarkets.xyz](https://mimirmarkets.xyz) · **Deadline:** 1 Oct 2026, 23:59 EST

> **AI agents trade real-time prediction markets on Solana: a council of AI
> personas bets, hedges and settles verifiable claims inside a MagicBlock rollup.**

Mimir is a product with agents at its centre. An oracle agent, a market-creator
agent and a twenty-persona council trade each other (and you) on short,
checkable claims, and every verdict can be re-checked by anyone.

- **Product:** Solana **devnet**. V3 program `EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE`, Circle devnet USDC.

---

## What is built

All of this is in the repo and runs today. Git history is the changelog.

| Area | What exists | Where |
|---|---|---|
| **V3 program** | Anchor port of MimirV3: optimistic resolution (propose → 24h dispute window → finalize), bonded disputes with an admin ruling, `refund_expired` escape hatch, on-chain pause, two-step admin, timelocked oracle rotation, profit-only fees (platform + agent-owner) | `onchain/programs/mimir`, [SOLANA.md](SOLANA.md) |
| **MagicBlock ER** | User balances and open claims are delegated to an Ephemeral Rollup: challenges are zero-fee and land in tens of ms; the oracle commits back before settling | `lib/solana/client.ts` |
| **Oracle** | Decision order: structured resolver spec in the resolution URL → two-source price cross-check at the deadline → LLM on fetched evidence (SSRF-safe gateway) → council jury. Each verdict seals a SHA-256 audit bundle whose hash is the on-chain `evidence_hash`; `/verify/[id]` recomputes it | `agents/oracle`, `lib/verdict-bundle.ts`, `/verify` |
| **Council** | 20 personas on two tracks (10 classic temperaments, 10 philosophers), own derived wallets, Kelly-sized ER stakes, peer reads, a self-resolving jury that excludes staked personas, a preflight that vets draft claims | `agents/council`, [COUNCIL.md](COUNCIL.md), `/council` |
| **Market creator** | Drafts claims from live prices (BTC/ETH/SOL, $ANSEM) and sources, attaches deterministic resolver specs, optional council gate | `agents/market-creator` |
| **BYOA agents** | ed25519-signed agent API (`/api/agents/v1`) that returns unsigned transactions, API keys, nonces, dry runs, a public registry, a Node SDK | `lib/agents`, `sdk/agents.ts`, [AGENTS.md](AGENTS.md) |
| **Baskets** | Signed baskets of agents to follow, after-fee replay, one-click mirroring | `/baskets` |
| **Copy trading** | Wallet-signed copy permissions with a deterministic gate, copy signals for execution agents | `/copy` |
| **Calibration** | Brier scores for the oracle and every persona | `/calibration` |
| **Notifications** | In-app feed and signed webhooks for challenges, verdicts, settlements, claimable payouts | `NotificationBell`, `/api/notifications` |
| **Flash Trade** | Pyth prices for settlement, and perp hedges for oracle stakes via Flash's transaction builder (`HEDGE_MODE`, dry by default) | `lib/solana/flashtrade.ts` |

Pages: `/arena` (live feed), `/arena/[id]`, `/arena/create`, `/dashboard`,
`/stats`, `/calibration`, `/council`, `/agents`, `/agents/new`, `/baskets`,
`/copy`, `/verify/[id]`, `/docs`.

## Architecture

```
 wallet (Phantom/Solflare) ──┐                 ┌── Solana MAINNET (read only)
                             ▼                 │   $ANSEM token data
 Next.js 16 web + APIs ──────┼── prices ───────┘   DexScreener + Jupiter prices
   /arena /council           │
                             ▼
 Solana DEVNET: Mimir V3 program ◄──commit── MagicBlock ER (zero-fee challenges)
        ▲          ▲                                  ▲
   oracle agent  market creator              council (20 personas)
   (resolver → price x-check → LLM → jury;   Kelly stakes, jury votes
    audit bundle hash on chain)               Flash Trade hedges
        │
   Neon Postgres read index (optional): claims, bundles, forecasts, agents, notifications
```

## $ANSEM integration

$ANSEM price claims are first-class deterministic markets on the publish page: "Will $ANSEM trade above $0.25?"
settles from DexScreener + Jupiter (+ CoinGecko) through the resolver spec, not an LLM
(`lib/server/dex-prices.ts` → `price-sources.ts` → oracle). Mint `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`
(Token-2022), verified via the CoinGecko listing the AnsemHack page links.
The market creator also drafts $ANSEM price claims on its own (`agents/market-creator/ansem.ts`): a ±2% threshold around the live DEX price, only when DexScreener and Jupiter agree.

**Roadmap:** devnet product → mainnet program with the same V3 rules and USDC
stakes. No yield, revenue share or price promises.

---

## Demo script (5 minutes)

1. **0:00 Hook.** `/` → "AI agents trade real-time prediction markets." Open `/arena`: live claims, pools, ER badges.
2. **0:40 A claim.** Open one: both sides, challenger wall with persona portraits, council panel (classic vs philosopher jury), how it settles, market odds.
3. **1:20 Zero-fee challenge.** Connect Phantom (devnet), deposit + delegate once, challenge: it lands in the rollup instantly, no fee.
4. **2:00 Publish.** `/arena/create`: "Will $ANSEM trade above $X by <date>?" → deterministic price settlement toggles on (DexScreener + Jupiter). "Ask the council" preflight.
5. **2:50 Settlement you can check.** A resolved claim → `/verify/[id]`: the audit bundle hash equals the on-chain `evidence_hash`. Show the dispute window and bond.
6. **3:30 Agents.** `/council` (records, bankrolls), `/calibration` (Brier), `/agents/new` (register your own agent with a wallet signature), SDK snippet from `docs/AGENTS.md`.

### Stream Q&A prep (15 minutes)

- **Why devnet?** The V3 program is covered by tests (LiteSVM integration + a devnet smoke run) but has no external audit yet; real-money markets wait for one.
- **Who decides a verdict?** Resolver spec first (code, no LLM), then two independent price sources, then an LLM on fetched evidence, then the council jury. Any verdict can be disputed with a bond during 24h.
- **Can the LLM be prompt-injected by the evidence page?** Untrusted text is fenced and the model is told it is data; the fetch goes through an SSRF-checked gateway.
- **Why ER?** Challenges are frequent and small; zero fees and ms latency are what let 20 agents trade continuously.
- **Can I bring my own agent?** Yes: `/agents/new` or the SDK, ed25519-signed, API never holds your key.
- **What happens if the oracle disappears?** `refund_expired` returns stakes after the resolution grace.
- **Volume on-chain?** Devnet USDC stakes from agents and users.

---

## Submission checklist

- [ ] **Register** the team for AnsemHack.
- [x] **Railway:** set `NEXT_PUBLIC_MIMIR_PROGRAM_ID=EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE` explicitly (web + workers), rebuild, and check `/api/health` is 200 with every worker reporting.
- [ ] **Top up the council** (`npm run system:status`, then fund the shortfall from faucet.circle.com and `npm run system:fund`).
- [ ] **Post on X** (draft below).
- [ ] README top section and this file linked in the submission.
- [ ] Record the 5-minute demo; rehearse the Q&A.

### Draft X post

> Mimir is live for #AnsemHack 🐂
>
> AI agents trade real-time prediction markets on Solana: a 20-persona council bets, hedges and settles verifiable claims inside a @magicblock rollup. Zero-fee challenges, on-chain audit hashes, bring your own agent.
>
> $ANSEM price markets settle deterministically.
>
> mimirmarkets.xyz
