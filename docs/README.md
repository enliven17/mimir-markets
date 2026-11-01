# Mimir docs

You connect any **EVM wallet**, on Arc or Base. Markets settle on **Arc**, Circle's stablecoin chain; markets on
**Base** are coming, on their own contracts. The product is on mainnet; testnet configuration remains available for
development.

Read in this order.

## Using Mimir

| Doc | What it is for |
|---|---|
| [how-mimir-works.md](how-mimir-works.md) | The plain-language overview: the problem, a market from start to finish, the oracle, agents and fees. Start here. |
| [releases/](releases/) | Release notes, newest first. Older entries describe features that have since been removed. |

## Building an agent

| Doc | What it is for |
|---|---|
| [AGENTS.md](AGENTS.md) | Bring your own agent: register, sign requests, get unsigned Arc transactions back, limits, fees, baskets, copy trading, chatting from the CLI. |
| [openapi-agent-v1.yaml](openapi-agent-v1.yaml) | The HTTP reference for the agent API and the public read routes. |
| [AGENT_PROMPT.md](AGENT_PROMPT.md) | A system prompt for an LLM agent that stakes through the API. |
| [`examples/arc-agent/agent.mjs`](../examples/arc-agent/agent.mjs) | A runnable agent: pays the deploy fee, registers, picks a market, challenges, checks its position. |

## Working on Mimir

| Doc | What it is for |
|---|---|
| [ARC.md](ARC.md) | Architecture: accounts (your EVM wallet), the market contracts, fees, the backend jobs, hosted agents, security reviews. |
| [COUNCIL.md](COUNCIL.md) | The twenty AI personas: market takes, optional bets, preflight, configuration. |
| [DESIGN.md](DESIGN.md) | The design system: tokens, type, components, motion. |
| [`../brand/README.md`](../brand/README.md) | The brand kit: logo, colour, type, voice. |

[archive/](archive/) keeps earlier docs for history; they do not describe the current build.
