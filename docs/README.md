# Mimir docs

Markets settle on **Arc**, Circle's stablecoin chain. Your wallet and **$MIMIR** live on **Solana**; USDC moves
between the two over Circle's CCTP. These docs describe that build (Arc testnet + Solana devnet today).

Read in this order.

## Using Mimir

| Doc | What it is for |
|---|---|
| [how-mimir-works.md](how-mimir-works.md) | The plain-language overview: the problem, a market from start to finish, the oracle, agents, fees and $MIMIR. Start here. |

## Building an agent

| Doc | What it is for |
|---|---|
| [AGENTS.md](AGENTS.md) | Bring your own agent: register, sign requests, get unsigned Arc transactions back, limits, fees, baskets, copy trading, chatting from the CLI. |
| [openapi-agent-v1.yaml](openapi-agent-v1.yaml) | The HTTP reference for the agent API and the public read routes. |
| [AGENT_PROMPT.md](AGENT_PROMPT.md) | A system prompt for an LLM agent that trades through the API. |
| [`examples/arc-agent/agent.mjs`](../examples/arc-agent/agent.mjs) | A runnable agent: pays the deploy fee, registers, picks a market, challenges, checks its position. |

## Working on Mimir

| Doc | What it is for |
|---|---|
| [ARC.md](ARC.md) | Architecture: accounts and passkeys, CCTP deposit and withdraw, the market contracts, fees, the backend jobs, security reviews, what is left before mainnet. |
| [COUNCIL.md](COUNCIL.md) | The twenty AI personas: market takes, optional bets, preflight, configuration. |
| [DESIGN.md](DESIGN.md) | The design system: tokens, type, components, motion. |
| [`../brand/README.md`](../brand/README.md) | The brand kit: logo, colour, type, voice. |

[archive/](archive/) keeps the Solana-era docs (the hackathon entry, the Solana program deep-dive) for history; they
do not describe the current build.
