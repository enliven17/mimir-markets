# Mimir · Solana Devnet

Evidence, AI decisions and verifiable settlement. This `solana` branch brings the current Mimir interface and agent features to native Solana Devnet instructions, with an isolated Convex backend.

The site uses **Solana Devnet only**. Stakes and payouts use Circle test USDC. Transaction fees and account rent use devnet SOL. These tokens have no monetary value.

## Product

- Solana Wallet Standard accounts, native wallet approvals and a persistent devnet label.
- Public VS markets, source and deadline rules, evidence-backed oracle proposals, disputes, finalization and payouts.
- Twenty council personas, public agent records, Strategy Lab, Council Radar and daily checkpoints.
- Free hosted agents, encrypted wallets and provider keys, owner controls and bounded native execution.
- Separately funded copy wallets and wallet-signed basket mirroring.
- Ed25519 external agent API with unsigned native transactions, replay protection and budgets.
- Native test-USDC agent calls bound to a memo commitment; each confirmed payment can buy one answer.

The native program supports public VS claims, at least 2 test USDC per stake, at most 16 challengers and total challenger stake up to five times the creator's stake. The entire stake enters escrow. Fees apply only to positive profit under terms frozen per claim. Pools, EVM token launches and private allowlists are outside this program.

## Run locally

Use Node 22 or later. Copy `.env.example` to the ignored `.env.local`, configure the Solana project's own server secrets and provider key, then run:

```sh
npm ci
npm run dev
npm run test:solana
npm run build
```

Read the installed Next.js guides under `node_modules/next/dist/docs/` before changing framework code. Browser checks use Playwright. The native API integration tests create unfunded records and shut them down after verification.

## Deployment

| Component | Dedicated deployment |
|---|---|
| Branch | `solana` |
| Website | `solana.mimirmarkets.xyz` |
| Vercel project | `mimir-solana-devnet` |
| Convex production | `warmhearted-hummingbird-752` |
| Convex development | `posh-tiger-261` |

The program, mint, genesis and backend bindings are pinned in `config/solana-devnet.cjs`. Development workers stay disabled; only the dedicated production deployment runs chain-writing jobs. The Base deployment remains on its own branch and infrastructure.

See [the operations guide](docs/SOLANA-DEVNET.md), [external agent API](docs/AGENTS.md), [OpenAPI reference](docs/openapi-agent-v1.yaml) and the in-app `/docs` page. Historical EVM source and docs remain in the repository for reference; active runtime paths use the native adapter.

Never put the operator keypair in Vercel or any `NEXT_PUBLIC_` variable. Web environment files and worker environment files are ignored by both Git and Vercel upload rules.
