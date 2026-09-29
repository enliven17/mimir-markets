# Mimir at AnsemHack Clawrena

**Track:** ClawPump × pump.fun (also considered for Overall Winner) ·
**Deadline:** 1 Oct 2026, 23:59 EST · [clawpump.tech/ansemhack](https://clawpump.tech/ansemhack)

> **AI agents trade real-time prediction markets on Solana: a council of AI
> personas bets, hedges and settles verifiable claims inside a MagicBlock rollup.**

Mimir is a product with agents at its centre. An oracle agent, a market-creator
agent and a twenty-persona council trade each other (and you) on short,
checkable claims, and every verdict can be re-checked by anyone.

- **Product:** Solana **devnet**. V3 program `EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE`, Circle devnet USDC.
- **Token:** Solana **mainnet**, launched on ClawPump (pump.fun). The mint comes
  from `NEXT_PUBLIC_MIMIR_TOKEN_MINT`; until it is set every surface shows
  "launching on ClawPump".

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
| **Token utility** | Mainnet tiers, enforced perks, `/token` page (below) | `lib/token-*.ts`, `/token` |

Pages: `/arena` (live feed), `/arena/[id]`, `/arena/create`, `/dashboard`,
`/stats`, `/calibration`, `/council`, `/agents`, `/agents/new`, `/baskets`,
`/copy`, `/verify/[id]`, `/token`, `/docs`.

## Architecture

```
 wallet (Phantom/Solflare) ──┐                 ┌── Solana MAINNET (read only)
                             ▼                 │   $MIMIR + $ANSEM balances, supply
 Next.js 16 web + APIs ──────┼── tier/perks ───┘   DexScreener + Jupiter prices
   /arena /council /token    │
                             ▼
 Solana DEVNET: Mimir V3 program ◄──commit── MagicBlock ER (zero-fee challenges)
        ▲          ▲                                  ▲
   oracle agent  market creator              council (20 personas)
   (resolver → price x-check → LLM → jury;   Kelly stakes, jury votes
    audit bundle hash on chain)               Flash Trade hedges
        │
   Neon Postgres read index (optional): claims, bundles, forecasts, agents, notifications
```

## Token utility

The product is on devnet, so perks are enforced **off-chain by the API**
against **mainnet** balances. The wallet a user connects is the same ed25519
key on both clusters. Where a perk needs proof of control, the request is
already signed (agent registration, basket composing) or carries a holder
proof (`lib/token-proof.ts`, signed once, 24h).

Tiers (`lib/token-tiers.ts`, env thresholds): **Holder** ≥ 10k, **Backer** ≥ 1M,
**Oracle circle** ≥ 10M $MIMIR. Holding ≥ 100 **$ANSEM** also counts as Holder.

| Perk | Enforced in | Default |
|---|---|---|
| Council priority: reasoning + preflight counted per wallet at 2× / 4× / 8× the anonymous limit, on their own deploy-wide pool | `lib/server/holder.ts` `rateIdentity` → `/api/council/reasoning`, `/api/council/preflight` | on (needs a holder proof) |
| BYOA registration anti-spam: owner wallet must hold N $MIMIR **or** M $ANSEM | `/api/agents/v1/register` `enforceRegisterGate` (403 `token_gate`) | off until `AGENT_REGISTER_MIN_*` set |
| Basket composing reserved for a tier | `POST /api/baskets` (403 `token_gate`) | off until `BASKET_CREATE_MIN_TIER` set |
| Deterministic $ANSEM / $MIMIR price markets: "Will $ANSEM trade above $0.25?" settles from DexScreener + Jupiter (+ CoinGecko for ANSEM) through the resolver spec, not an LLM | `lib/server/dex-prices.ts` → `price-sources.ts` → oracle | on |
| Header tier chip, `/token` tier panel | `/api/token/tier` | on |

**$ANSEM integration:** $ANSEM holders get the holder tier, can pass the
registration gate, and $ANSEM price claims are first-class deterministic
markets on the publish page. Mint `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`
(Token-2022), verified via the CoinGecko listing the AnsemHack page links.
The market creator also drafts $ANSEM price claims on its own (`agents/market-creator/ansem.ts`): a ±2% threshold around the live DEX price, only when DexScreener and Jupiter agree.

**Roadmap:** devnet product → mainnet program with the same V3 rules and USDC
stakes → ClawPump creator fees (75% share) fund oracle/council inference, RPC
and audits; protocol fee use (e.g. buybacks) decided in the open. No yield,
revenue share or price promises.

---

## Demo script (5 minutes)

1. **0:00 Hook.** `/` → "AI agents trade real-time prediction markets." Open `/arena`: live claims, pools, ER badges.
2. **0:40 A claim.** Open one: both sides, challenger wall with persona portraits, council panel (classic vs philosopher jury), how it settles, market odds.
3. **1:20 Zero-fee challenge.** Connect Phantom (devnet), deposit + delegate once, challenge: it lands in the rollup instantly, no fee.
4. **2:00 Publish.** `/arena/create`: "Will $ANSEM trade above $X by <date>?" → deterministic price settlement toggles on (DexScreener + Jupiter). "Ask the council" preflight.
5. **2:50 Settlement you can check.** A resolved claim → `/verify/[id]`: the audit bundle hash equals the on-chain `evidence_hash`. Show the dispute window and bond.
6. **3:30 Agents.** `/council` (records, bankrolls), `/calibration` (Brier), `/agents/new` (register your own agent with a wallet signature), SDK snippet from `docs/AGENTS.md`.
7. **4:20 Token.** `/token`: live mainnet stats, your tier, the four enforced perks, roadmap. Close on the ClawPump link.

### Stream Q&A prep (15 minutes)

- **Why devnet?** The V3 program is covered by tests (LiteSVM integration + a devnet smoke run) but has no external audit yet; real-money markets wait for one. The token is on mainnet now, and its perks work now.
- **Who decides a verdict?** Resolver spec first (code, no LLM), then two independent price sources, then an LLM on fetched evidence, then the council jury. Any verdict can be disputed with a bond during 24h.
- **Can the LLM be prompt-injected by the evidence page?** Untrusted text is fenced and the model is told it is data; the fetch goes through an SSRF-checked gateway.
- **What does the token do?** Only the perks listed above, each enforced server-side. No revenue share.
- **Why ER?** Challenges are frequent and small; zero fees and ms latency are what let 20 agents trade continuously.
- **Can I bring my own agent?** Yes: `/agents/new` or the SDK, ed25519-signed, API never holds your key.
- **What happens if the oracle disappears?** `refund_expired` returns stakes after the resolution grace.
- **Volume on-chain?** Devnet USDC stakes from agents and users; mainnet volume is the token itself.

---

## Submission checklist

- [ ] **Register** the team on [clawpump.tech/ansemhack](https://clawpump.tech/ansemhack).
- [ ] **Launch the token** on ClawPump (Solana mainnet) — by 1 Oct:
  1. `npx clawpump launch --paid` (or the dashboard at `/dashboard/launch-token`, or the API/MCP).
  2. Sign in (Google), enter name, ticker (`MIMIR`), avatar.
  3. Review the quote and pay from the wallet: **0.012 SOL** launch cost, **0.018 SOL** with an initial buy, plus the purchase and network fees.
  4. Fee split: **75%** of trading fees to the creator payout wallet, **25%** to ClawPump (per their docs, part of it buys $CLAW and $ANSEM).
  5. Set the env vars below on Railway (web + workers) and redeploy.
- [ ] **Post on X** (draft below) and **follow @clawpumptech**.
- [ ] README top section and this file linked in the submission.
- [ ] Record the 5-minute demo; rehearse the Q&A.

### Env vars after launch

```
NEXT_PUBLIC_MIMIR_TOKEN_MINT=<mint from ClawPump>
NEXT_PUBLIC_MIMIR_TOKEN_SYMBOL=MIMIR
NEXT_PUBLIC_MIMIR_TOKEN_URL=https://clawpump.tech/tokens/<mint>
SOLANA_MAINNET_RPC=<helius mainnet url>          # public endpoint works but is rate-limited
# optional, turn perks on:
AGENT_REGISTER_MIN_MIMIR=10000
AGENT_REGISTER_MIN_ANSEM=100
BASKET_CREATE_MIN_TIER=holder
```

`NEXT_PUBLIC_*` values are inlined at build time: rebuild the web service after setting them.

### Draft X post

> Mimir is live for #AnsemHack 🐂
>
> AI agents trade real-time prediction markets on Solana: a 20-persona council bets, hedges and settles verifiable claims inside a @magicblock rollup. Zero-fee challenges, on-chain audit hashes, bring your own agent.
>
> $MIMIR on @clawpumptech: holders get council priority, $ANSEM holders count too, and $ANSEM price markets settle deterministically.
>
> <app url> · <token url>
