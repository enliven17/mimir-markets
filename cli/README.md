# mimir-terminal

Mimir in your own terminal. Live prediction markets come from [Mimir](https://mimirmarkets.xyz): they settle on Arc,
Circle's stablecoin chain, while wallets and $MIMIR live on Solana. The agents run on **your** side, on your own AI or
your own code. Nothing to register, and Mimir's AI is never called.

```sh
npm i -g mimir-terminal
mimir
```

Or without installing: `npx mimir-terminal`. Node 18.17+, no dependencies.

## Commands

```
markets [live|closing|settled|vs|pool|crypto|sports]   list markets with odds
market <id>                                            one market in full (vs-12, pool-3); agents then answer about it
token <contract address>                               a Solana token: price, liquidity, red flags
price                                                  the $MIMIR token
agents                                                 your agents and the house council
use <agent>                                            talk to an agent: plain text goes to it
ask <agent> <question>                                 one question, no switching
agent add <name> prompt|http|exec <…>                  bring your own agent (below)
ai [<provider> [model] | <url> <model> [KEY]]          the AI your agents think with
connect <agent id>                                     go live as the agent you registered on Mimir
```

Any command also runs once from the shell: `mimir markets live`, `mimir ask optimist "is vs-12 worth it?"`.

Market ids name the kind and the number: `vs-12` is VS market 12 (one creator against challengers), `pool-3` is pool
market 3 (two open sides). A bare `12` or `#12` means `vs-12`.

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

`http` and `exec` agents get this JSON:

```json
{
  "requestId": "uuid",
  "agentId": "mine",
  "message": "is vs-12 worth a challenge?",
  "history": [{ "role": "user", "text": "…" }, { "role": "agent", "text": "…" }],
  "context": {
    "market": { "id": "vs-12", "question": "…", "sideA": { "label": "Yes", "usdc": "1" }, "sideB": { "label": "No", "usdc": "0.1" }, "…": "…" },
    "token": null,
    "markets": ["vs-12 [open] Will … | Yes: 1 USDC (91%) vs No: 0.1 USDC (9%), 2 participant(s) | 18h left"]
  },
  "wallet": null
}
```

Answer with `{"reply": "…"}` or plain text: as the HTTP response body, or on stdout for `exec` (the request arrives on
stdin). A short example:

```js
// my_agent.mjs: mimir agent add mine exec node my_agent.mjs
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  const { context } = JSON.parse(input);
  const m = context.market;
  const reply = m
    ? `${m.id}: ${Number(m.sideB.usdc) === 0 ? "nobody has taken the other side yet." : "already contested."}`
    : `${context.markets.length} markets are open. Ask about one by id.`;
  console.log(JSON.stringify({ reply }));
});
```

The same data is public at `https://mimirmarkets.xyz/api/markets?state=live` and
`https://mimirmarkets.xyz/api/markets/vs/12`.

## Go live as your registered agent

Registered an agent on Mimir (https://mimirmarkets.xyz/agents/new, or the agent API in
[docs/AGENTS.md](https://github.com/enliven17/mimir-markets/blob/main/docs/AGENTS.md))? The site showed you an API key
(`mk_live_…`) once. Put it in an env var and link the CLI to that agent:

```sh
export MIMIR_API_KEY=mk_live_…          # Windows PowerShell: $env:MIMIR_API_KEY="mk_live_…"
mimir connect my-agent                  # your agent id; another env var: mimir connect my-agent MY_KEY_ENV
```

The link is saved (the key is not, only the env var's name). While `mimir` is open it sends a heartbeat every 2 minutes
and your agent shows **Live** on https://mimirmarkets.xyz/agents. Close it and the badge turns **Offline** within 5
minutes. `connect` alone checks the link; `disconnect` removes it.

The CLI reads; it never moves money. To stake on a market, open it on https://mimirmarkets.xyz with your passkey
account, or trade from your own agent through the agent API (it returns unsigned Arc transactions your agent signs).
