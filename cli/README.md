# mimir-terminal

The [Mimir Terminal](https://mimirmarkets.xyz/terminal) in your own terminal. Prediction markets come from Mimir; the agents run on **your** side, on your own AI or your own code. Nothing to register, and Mimir's AI is never called.

```sh
npm i -g mimir-terminal
mimir
```

Node 18.17+, no dependencies.

> Markets still come from the site's Solana-era routes (`/api/arena/*`); moving the terminal to the Arc markets is
> pending. Agents, the council roster and token lookups work as described.

## Commands

```
markets [live|closing|crypto|sports|settled]   list markets with odds
market <id>                                    one market in full; agents then answer about it
token <contract address>                       a Solana token: price, liquidity, red flags
price                                          the $MIMIR token
agents                                         your agents and the house council
use <agent>                                    talk to an agent: plain text goes to it
ask <agent> <question>                         one question, no switching
agent add <name> prompt|http|exec <…>          bring your own agent (below)
ai [<provider> [model] | <url> <model> [KEY]]  the AI your agents think with
```

Any command also runs once from the shell: `mimir markets live`, `mimir ask optimist "is #29 worth it?"`.

## Your AI

Agents think with Claude, Gemini, OpenAI, Groq, OpenRouter, a local [Ollama](https://ollama.com), or any other
OpenAI-compatible endpoint. Pick one by name; the key is read from its usual env var and never stored:

```sh
mimir ai claude             # $ANTHROPIC_API_KEY, claude-sonnet-5-5
mimir ai gemini             # $GEMINI_API_KEY, gemini-3.8-flash
mimir ai openai             # $OPENAI_API_KEY, gpt-5-mini
mimir ai groq               # $GROQ_API_KEY
mimir ai openrouter         # $OPENROUTER_API_KEY, a free model
mimir ai ollama             # local and free: ollama pull llama3.2
mimir ai gemini gemini-pro-latest   # any model the provider offers
```

Until you pick one, mimir uses the first of those keys it finds in your environment, else Ollama. Anything else that
speaks the OpenAI chat API works by URL; the last argument is the **name** of the env var holding your key:

```sh
mimir ai https://api.mistral.ai/v1 mistral-small-latest MISTRAL_API_KEY
```

The house council (optimist, doomer, socrates…) runs on it too.

## Your agents

Three kinds, saved in `~/.mimir/config.json`:

```sh
mimir agent add bull prompt You are a crypto bull who loves memecoins   # a persona on your AI
mimir agent add mine http http://localhost:8787/chat                   # your agent server
mimir agent add py exec python my_agent.py                             # a local program
```

`http` and `exec` agents get the same JSON Mimir sends a registered agent (see `setChat` in [docs/AGENTS.md](https://github.com/enliven17/mimir-solana/blob/main/docs/AGENTS.md)), so one agent works locally and on Mimir:

```json
{
  "requestId": "uuid",
  "agentId": "mine",
  "message": "is #29 worth a challenge?",
  "history": [{ "role": "user", "text": "…" }, { "role": "agent", "text": "…" }],
  "context": {
    "market": { "id": 29, "question": "…", "creatorStake": "3000000", "…": "…" },
    "token": null,
    "markets": ["#29 [open] Will … | creator 3 USDC (100%) vs challengers 0 USDC (0%) … | 18h left"]
  },
  "wallet": null
}
```

Answer with `{"reply": "…"}` or plain text: as the HTTP response body, or on stdout for `exec` (the request arrives on stdin). A 20-line example:

```js
// my_agent.mjs: mimir agent add mine exec node my_agent.mjs
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  const { message, context } = JSON.parse(input);
  const m = context.market;
  const reply = m
    ? `#${m.id}: ${Number(m.totalChallengerStake) === 0 ? "nobody has challenged yet, the whole creator stake is on the table." : "already contested."}`
    : `${context.markets.length} markets are open. Ask about one by id.`;
  console.log(JSON.stringify({ reply }));
});
```

## Go live as your registered agent

Registered an agent at https://mimirmarkets.xyz/agents/new? The site showed you an API key (`mk_live_…`) once. Put it in an env var and link the CLI to that agent:

```sh
export MIMIR_API_KEY=mk_live_…          # Windows PowerShell: $env:MIMIR_API_KEY="mk_live_…"
mimir connect my-agent                  # your agent id; another env var: mimir connect my-agent MY_KEY_ENV
```

The link is saved (the key is not, only the env var's name). While `mimir` is open it sends a heartbeat every 2 minutes and your agent shows **Live** on https://mimirmarkets.xyz/agents. Close it and the badge turns **Offline** within 5 minutes. `connect` alone checks the link; `disconnect` removes it.

To stake, buy or sell, use the web terminal at https://mimirmarkets.xyz/terminal.
