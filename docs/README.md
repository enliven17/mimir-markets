# Mimir docs

Mimir runs on **BNB Smart Chain** by default: `MimirV3Erc20` and `MimirPoolErc20` with Binance-Peg USDC (18
decimals), gas in BNB, and `MimirBscFees` for entry fees and the Binance Agent ID discount. Base is wound down; Arc is
legacy. Docs that still describe Base or Arc as primary are marked below.

> Staking can lose you your entire stake. Read the risks in [how-mimir-works.md](how-mimir-works.md#risks) first.

Read in this order.

## Using Mimir

| Doc | What it is for |
|---|---|
| [how-mimir-works.md](how-mimir-works.md) | Start here. Markets, the oracle pipeline, Proof of Reasoning, Sentinels and disputes, contract permissions, fees, risks. |
| [releases/](releases/) | Release notes, newest first. Older entries describe features that have since been removed. |

## Verifying Mimir

| Doc | What it is for |
|---|---|
| [PROOF-OF-REASONING.md](PROOF-OF-REASONING.md) | The four-leaf Merkle commitment behind every verdict: encoding, versions, a dependency-free verification script, single-step proofs. |
| [SENTINELS.md](SENTINELS.md) | Disputing as a Binance Agent ID holder without a position: who may dispute, the bond, and the Sentinel agent (`agents/sentinel`). |

## Building an agent

| Doc | What it is for |
|---|---|
| [AGENTS.md](AGENTS.md) | Bring your own agent: register, sign requests, get unsigned transactions back, limits, fees, baskets, copy trading. Written for Arc and Base; check chain names against `lib/chains/registry.ts`. |
| [openapi-agent-v1.yaml](openapi-agent-v1.yaml) | The HTTP reference for the agent API and the public read routes. |
| [AGENT_PROMPT.md](AGENT_PROMPT.md) | A system prompt for an LLM agent that stakes through the API. |
| [`examples/arc-agent/agent.mjs`](../examples/arc-agent/agent.mjs) | A runnable agent (Arc): pays the deploy fee, registers, picks a market, challenges, checks its position. |

## Working on Mimir

| Doc | What it is for |
|---|---|
| [CHAINS.md](CHAINS.md) | Architecture: the chain registry, amounts, linked markets, accounts, the market contracts, the backend jobs, hosted agents, security reviews. Written when Base was primary; the contract rules still hold on BSC. |
| [COUNCIL.md](COUNCIL.md) | The AI personas: market takes, configuration. |
| [DESIGN.md](DESIGN.md) | The design system: tokens, type, components, motion. |
| [BASE-TESTNET.md](BASE-TESTNET.md), [BASE-MAINNET.md](BASE-MAINNET.md) | Base runbooks, kept for history (Base is wound down). |
| [`../scripts/bsc/deploy-markets.mts`](../scripts/bsc/deploy-markets.mts) | BSC deploy: roles, dispute window, caps, BscScan verification commands. |
| [`../brand/README.md`](../brand/README.md) | The brand kit: logo, colour, type, voice. |

[archive/](archive/) keeps earlier docs for history; they do not describe the current build.
