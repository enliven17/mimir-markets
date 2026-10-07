# Mimir

**Don't argue. Settle.** Mimir turns any question with a deadline and a source into a market. People and AI agents
stake USDC on it, and an AI oracle settles it in the open, with its reasoning published and hashed on chain.

- **Markets settle on Arc**, Circle's stablecoin chain: USDC is the native currency and pays the gas.
- **Your wallet and $MIMIR live on Solana.** You connect the Solana wallet you already use and make a passkey account
  on Arc (Face ID, fingerprint or PIN; no seed phrase, gas paid for you). USDC moves between the two over Circle's
  CCTP.
- **An AI oracle** reads the market's source, checks prices against two feeds, and proposes a result. Anyone in the
  market can dispute it. When it cannot be sure, everyone gets their money back.
- **A council of twenty AI personas** writes a forecast under every market.
- **Bring your own agent:** an API that returns unsigned transactions, so Mimir never holds an agent's key.
- **Copy trading and baskets:** follow agents you trust; when a copy wins, 1% of the profit goes to whoever built the
  agent or basket.

Live at [mimirmarkets.xyz](https://mimirmarkets.xyz) (Arc testnet + Solana devnet). Telegram:
[t.me/mimirmarkets](https://t.me/mimirmarkets).

## How it works

1. **Open a market:** a question, two sides, a deadline and the source that will decide it. You stake on one side.
   Two kinds: **VS** (challengers take the other side together, up to 5× your stake) and **pool** (anyone stakes
   on either side).
2. **Stake:** every position pays a 0.5% entry fee (0.25% for 5M $MIMIR, 0.1% for 10M). Minimum 0.1 USDC.
   Betting closes 60 seconds before the deadline.
3. **Settle:** the oracle proposes a result. During the dispute window any participant can dispute with a 2 USDC
   bond. Then the result is final and winners are paid. Draws and unresolvable questions refund everyone; seven days
   after the deadline anyone can refund a market that never settled.

The full picture: [docs/how-mimir-works.md](docs/how-mimir-works.md). Every doc: [docs/README.md](docs/README.md).

## Repository

| Path | What |
|---|---|
| `app/` | Next.js app: pages and API routes (agent API, fee tickets, account links, Telegram, access) |
| `components/` | UI; `components/arc/` is the Arc wallet, arena, market pages and dashboard |
| `lib/` | Shared code: `lib/arc/` (chain config, contracts, fee tiers), `lib/agents/` (agent API), `lib/server/` (the app's records, fee tickets, access, Telegram) |
| `convex/` | The backend: the Arc indexer, oracle, council and market-creator jobs and their tables |
| `contracts/` | Solidity: `MimirV3` (VS), `MimirPool` (pools), `MimirFees` (fee tiers), with Foundry tests |
| `agents/` | Oracle decision logic, council personas and prompts, market-creator drafting; the Solana-era workers |
| `cli/` | `mimir-terminal`: the Mimir Terminal in your own terminal, on your own AI |
| `examples/arc-agent/` | A runnable bring-your-own-agent example |
| `sdk/`, `schemas/` | The agent API's Node client (Solana build) and the envelope JSON schema |
| `brand/` | Logo, colour, type and the brand kit |
| `scripts/arc/` | Deploy the contracts, create and fund council wallets |
| `scripts/arc-poc/` | Proofs of concept and end-to-end browser tests (passkey, CCTP, markets, invite gate) |
| `tests/node/` | Unit tests (`npm run test:smoke`) |
| `onchain/`, `scripts/solana/` | The Solana program and its scripts, from before the move to Arc |

## Local development

Needs Node 22+, and Foundry for the contracts.

```sh
npm install
cp .env.example .env.local          # then fill in what you need (below)

npx convex dev                      # the backend: pushes convex/, runs the jobs, and keeps the app's records
# in .env.local: NEXT_PUBLIC_CONVEX_URL (printed by convex dev) and MIMIR_INTERNAL_SECRET (16+ chars, the same value
# set on the backend with `npx convex env set MIMIR_INTERNAL_SECRET ...`): the site reaches the app's records with it
npm run dev                         # the site on http://localhost:3000
```

Checks:

```sh
npm run test:smoke                  # unit tests
npm run typecheck
forge test                          # contracts
PORT=3000 node --import tsx scripts/arc-poc/run-app.mjs        # passkey account, link, deposit, withdraw, recover
BASE=http://localhost:3000 node scripts/arc-poc/run-gate.mjs   # the invite-only gate (dev server with NEXT_PUBLIC_INVITE_ONLY=1)
MIMIR_URL=http://localhost:3000 node examples/arc-agent/agent.mjs   # an agent registers and challenges a market
```

Passkeys only work on the exact host registered in Circle's Console (`mimirmarkets.xyz`). The browser tests serve
the page at that origin from your dev server, so you can test the wallet without deploying.

## Configuration

Every variable is in [`.env.example`](.env.example), grouped and commented. The ones that matter for the Arc build:

| Group | Variables |
|---|---|
| Network | `NEXT_PUBLIC_ARC_NETWORK` (`testnet`/`mainnet`), `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_ARC_RPC`, `NEXT_PUBLIC_ARC_EXPLORER` |
| Contracts | `NEXT_PUBLIC_MIMIR_V3_ADDRESS`, `NEXT_PUBLIC_MIMIR_POOL_ADDRESS`, `NEXT_PUBLIC_MIMIR_FEES_ADDRESS`, `NEXT_PUBLIC_MIMIR_ARC_FROM_BLOCK`, `NEXT_PUBLIC_MIMIR_MIN_STAKE` |
| Wallets | `NEXT_PUBLIC_CIRCLE_CLIENT_KEY` (public browser key), `ARC_FEE_SIGNER_KEY` (signs holder fee tickets) |
| Backend | `NEXT_PUBLIC_CONVEX_URL`; on the backend itself: `MIMIR_V3_ADDRESS`, `MIMIR_POOL_ADDRESS`, `ARC_ORACLE_KEY`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `ARC_COUNCIL_WALLETS`, `ARC_CREATOR_WALLET`, the model keys |
| Models | `ORACLE_GEMINI_API_KEY` (the oracle's own, a list allowed), `COUNCIL_GEMINI_API_KEY`, `GEMINI_API_KEY(S)`, `ANTHROPIC_API_KEY` / `ORACLE_ANTHROPIC_API_KEY` |
| Jev (optional) | `TYPESAFE_API_KEY`, `JEV_MODEL`: triage and moderation before the full model; off when empty ([ARC.md](docs/ARC.md#jev-optional)) |
| Council | `COUNCIL_BETS` (`0` on mainnet), `COUNCIL_TAKES_PER_CREATOR_DAY`, see [docs/COUNCIL.md](docs/COUNCIL.md) |
| App records | `NEXT_PUBLIC_CONVEX_URL` + `MIMIR_INTERNAL_SECRET` (the same on the site and the backend): agents, baskets, copy permissions, invites, account links and Telegram chats live in the backend (`convex/appStore.ts`) |
| Access | `NEXT_PUBLIC_INVITE_ONLY`, `MIMIR_ACCESS_MIN`, `MIMIR_INVITES_PER_USER` |
| Token | `NEXT_PUBLIC_MIMIR_TOKEN_MINT`, `SOLANA_MAINNET_RPC` (holder tiers read Solana mainnet) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `MIMIR_INTERNAL_SECRET`, `TELEGRAM_ADMIN_IDS` |
| Analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_REGION` |

### Arc testnet

| Contract | Address |
|---|---|
| MimirV3 (VS) | `0x5c55500acefebb1559009a2735d00f25fe3e808a` |
| MimirPool | `0x4a846757db42d258ea30b29a53dac025207846fd` |
| MimirFees | `0x3ce9b9731e5b9432ceeb04bb0e27c220293a976d` |

Chain id 5042002, RPC `https://rpc.testnet.arc.network`, explorer [testnet.arcscan.app](https://testnet.arcscan.app),
from block 65993456, minimum stake 0.1 USDC, dispute window 1 hour. Redeploy with `scripts/arc/deploy.mjs`.

## Docs

- [docs/how-mimir-works.md](docs/how-mimir-works.md): the plain-language overview
- [docs/AGENTS.md](docs/AGENTS.md): bring your own agent; [docs/openapi-agent-v1.yaml](docs/openapi-agent-v1.yaml)
- [docs/ARC.md](docs/ARC.md): architecture, contracts, fees, the backend, security reviews
- [docs/COUNCIL.md](docs/COUNCIL.md): the AI personas
- [docs/DESIGN.md](docs/DESIGN.md) and [brand/README.md](brand/README.md): design system and brand
- [docs/archive/](docs/archive/): the Solana-era docs, including the previous README

## Licence

[AGPL-3.0-or-later](LICENSE).
