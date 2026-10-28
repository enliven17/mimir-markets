// The release notes, shown as a section of /docs (/mainnet redirects there), newest first. MAINNET-TODO.md, docs/ARC.md
// and the Launch code (lib/launch, convex/launch*.ts) are the sources; keep this in step.

type Release = { date: string; title: string; intro: string; sections: Array<{ title: string; points: string[] }> };

const RELEASES: Release[] = [
  {
    date: "October 28, 2026",
    title: "Mimir API",
    intro: "Launched agents are now callable from any app. Pay the agent's own wallet on Arc, Solana or Robinhood Chain, then call it.",
    sections: [
      { title: "Pay the agent, use the agent", points: [
        "POST /api/launch/<agent>/call with a prompt. Without a payment the answer is 402 with a quote per chain: USDC on Arc, SOL on Solana, ETH on Robinhood Chain, each paid to the agent's own wallet.",
        "Retry with X-Mimir-Payment: <chain>:<tx>. The transfer is read from the chain, one tx buys one call, and a call the agent could not answer leaves the payment unused.",
        "Calls only talk: they cannot move funds, trade or change settings. Each paid call appears on the agent's log with its transaction.",
      ] },
    ],
  },
  {
    date: "October 26, 2026",
    title: "Records, copy controls and discovery",
    intro: "Inspect an agent's public execution evidence, test two settings with virtual funds, and follow markets through their resolution. Six connected improvements across Launch, Preview, the Arena and $MIMIR.",
    sections: [
      { title: "Public agent records", points: [
        "Launched agents show 7/30/90-day confirmed execution counts, realized trading PnL, return on closed token cost and explorer links before the token chart. Public Arc position outcomes are shown separately in USDC, including on council pages.",
        "Open position cost and realized PnL drawdown are named explicitly. They are not current market value or portfolio equity drawdown. Pending fills and simulated returns do not enter the real execution record; capped histories are labelled.",
        "Paused and shut-down hosted agents remain in the directory. Detailed reasoning remains a $MIMIR benefit.",
      ] },
      { title: "Shared Solana copy controls", points: [
        "Set a token cost cap, total open-cost cap, daily realized-loss cap and realized-PnL drawdown cap across your Solana copy subscriptions. Pending buys reserve the executor's spend ceiling, including fee headroom, atomically.",
        "New copies check price deviation, a two-minute signal age and quoted liquidity. A shared per-signal liquidity ceiling limits aggregate copy demand. Missing evidence skips a buy; unknown signed buys retain their reservation until reconciliation.",
        "Copy exits record actual proceeds and proportional remaining cost once per signature. Your recorded 30-day copy PnL appears alongside the agent's 30-day trading result, with capital and start-date differences stated. These controls do not guarantee prices or limit unrealized losses; Arc retains its separate per-stake caps.",
      ] },
      { title: "Strategy Lab", points: [
        "From your Preview dashboard, fork a strategy into fresh A/B variants comparing stop loss or minimum market edge. Two free agent slots are required; each variant keeps its own virtual funds and paper results.",
        "New previews record the settings fingerprint, configured model and revision lineage. The comparison table shows actual paper results and settings. This is forward testing with shared feeds and AI quotas, not a historical backtest.",
        "Going live preserves the rules for review. The live brain, execution costs and required funding remain explicit, and virtual balances never become real funds.",
      ] },
      { title: "Council radar and watchlists", points: [
        "/radar compares each persona's latest explicit direction. Read-only council forecasts run even with betting disabled, share the existing per-tick attempt budget, and never change stake decisions. Personas can share models and sources; counts are not independent probabilities.",
        "Follow public markets, topics, agent forecasts and checkpoint series with a wallet signature. Your private in-app watchlist shows new forecasts, side changes, changed source evidence, hosted-agent stakes and market state changes. Followed markets receive a closing-soon reminder while the feed is open.",
      ] },
      { title: "Measurable $MIMIR benefits", points: [
        "/token shows verified indexed pool entry-fee savings against a 0.5% baseline, current fee eligibility and Preview usage. Unmatched fee evidence, VS entries, gas and copy profit fees are excluded.",
        "New Preview sessions receive per-agent daily AI caps of 6 / 8 / 10 / 12 and chart histories of 144 / 288 / 576 / 864 observed points for Standard / Holder / Backer / Oracle Circle. Verified $MIMIR holdings set the session tier; global AI budgets still apply.",
      ] },
      { title: "Daily checkpoints and a clearer start", points: [
        "SOL and BTC checkpoint templates reuse a machine-readable price rule and a 12:00 UTC deadline. The Arena points to an existing matching pool; a new occurrence always needs a reviewed signature and stake.",
        "Market pages display opening, betting close, the evidence checkpoint, the oracle proposal, dispute review and final outcome in one timeline. Payout collection remains a separate step.",
        "The landing page offers three ways in: virtual funds, agent discovery or a market. Optional product funnel events use the existing analytics integration and distinguish paper from live activity.",
      ] },
    ],
  },
  {
    date: "October 19, 2026",
    title: "Robinhood Chain",
    intro: "Agents can now live on Robinhood Chain: their own token on Pons, trading Pons tokens in ETH, and staking on Mimir markets on Arc like every agent. Pick the launchpad when you launch: pump.fun on Solana, Argus on Arc, or Pons on Robinhood Chain.",
    sections: [
      {
        title: "Launch on Pons",
        points: [
          "Pick Pons on the first step of /launch/new. The agent gets a wallet on Robinhood Chain and one on Arc; it needs no Solana wallet.",
          "Connect your Robinhood Wallet (or any EVM wallet) and send the seed ETH from it. 0.001 ETH covers the Pons launch fee and gas; the rest is its bankroll.",
          "Its token launches on Pons from the agent's own wallet, on a bonding curve that moves into a Uniswap v4 pool once 4.2 ETH is raised.",
          "Launching still needs $MIMIR in the Solana wallet you sign with.",
        ],
      },
      {
        title: "What the agent does",
        points: [
          "It finds tokens among new Pons launches, the busiest Pons curves and graduated Pons pools, ranks them against your thesis and trades within your rules: entry rules, position size, stop loss, take profit, trailing stop, max hold and a daily loss cap.",
          "It buys and sells on the curve while a token is on it, and on Uniswap v4 after it graduates. It never sells its own token.",
          "Every hour it claims its token's creator fees into its own wallet, where they become bankroll.",
          "It keeps staking USDC on Mimir markets from its Arc wallet. Its log, trades and PnL show in ETH on its page.",
        ],
      },
      {
        title: "Your ETH stays yours",
        points: [
          "The agent's wallet is locked by policy to Robinhood Chain. It can trade on Pons and Uniswap and send ETH only to the Robinhood wallet you funded it from.",
          "Withdraw part of its ETH from its page any time. Shut it down and it sells its positions and sends its ETH back to that same wallet.",
        ],
      },
    ],
  },
  {
    date: "October 14, 2026",
    title: "Mimir Launch",
    intro: "Launch your own AI agent: its own token on pump.fun, a wallet on Arc that stakes on Mimir markets and a wallet on Solana that trades. Agents and the council now live together on one page.",
    sections: [
      {
        title: "What goes live",
        points: [
          "Launch an agent at /launch: a name, a ticker, a face and a thesis in plain words. Its token goes live on pump.fun, minted by the agent's own wallet.",
          "Two wallets per agent. On Arc it stakes USDC on Mimir markets where it finds an edge, sized at a fraction of Kelly. On Solana it trades tokens under the strategy you set (optional). Each wallet pays its own gas.",
          "Its brain: Mimir AI is included, or bring your own key (OpenAI, Anthropic, Gemini, Groq, OpenRouter). Your key is checked with one call, encrypted and tied to that agent; you only see its last four characters again.",
          "Your rules bind it in code: categories, smallest edge, most per market and at stake; entry rules, position size, stop loss, take profit, trailing stop, max hold and a daily loss cap. The AI only judges what passes them.",
          "Agents may open markets of their own if you turn it on: up to 3 a day, held to the house creator's rules, with the gas and a 0.1 USDC seed stake from the agent's Arc wallet.",
          "Pause, resume, withdraw part of its funds or shut it down from its page. SOL comes back to your wallet, USDC to your linked Arc account.",
        ],
      },
      {
        title: "Creator fees",
        points: [
          "Every trade of an agent's token earns pump.fun creator fees for the agent. 10% goes to the platform and 10% to AI costs.",
          "You split the other 80%: gas and bankroll, buyback and burn, a payout to you, airdrops to its top holders. A change shows at once and takes effect 24 hours later.",
          "An agent people trade pays its own gas.",
        ],
      },
      {
        title: "Copy trading",
        points: [
          "Follow any agent and copy its Arc stakes, its Solana trades or both, from your own copy wallet with your own caps.",
          "Copy wallets can only send funds back to you. Stop at any time, sell what was copied and withdraw.",
        ],
      },
      {
        title: "The council has tokens",
        points: [
          "All 20 council personas launched their own pump.fun token from their own Solana wallet, and keep staking from their Arc wallets.",
          "/agents and /council are now one page: /launch.",
        ],
      },
      {
        title: "Who can use it",
        points: [
          "Launching an agent, seeing an agent's full record (PnL, win rate, trades, reasoning log) and copy trading need $MIMIR in your wallet.",
          "Anyone can buy an agent's own token and see its face, chart and wallets.",
        ],
      },
    ],
  },
  {
    date: "October 13, 2026",
    title: "Mainnet",
    intro: "Mimir goes live on Arc mainnet. Prediction markets run by AI, with real USDC. Invite-only at first, with low caps, while the contracts earn trust.",
    sections: [
      {
        title: "What goes live",
        points: [
          "Markets on Arc mainnet with real USDC. Your wallet and your funds stay on Solana mainnet.",
          "USDC moves between Solana and Arc over Circle CCTP: one transaction in, one out.",
          "A passkey account: Face ID, a fingerprint or your device PIN. No seed phrase, gas paid for you, and a 12-word recovery file you keep.",
          "Head-to-head markets and pools, from 0.1 USDC.",
          "The AI oracle settles every market and shows its sources and reasoning. Anyone can dispute a result within 24 hours.",
          "Telegram alerts and the agent API work on mainnet from day one.",
        ],
      },
      {
        title: "How to get in",
        points: [
          "Mainnet opens invite-only.",
          "A wallet holding at least 5,000,000 $MIMIR gets in directly.",
          "Everyone else needs an invite code from a member. Every member gets 2 codes to share.",
        ],
      },
      {
        title: "How it is kept safe",
        points: [
          "The contracts are owned by a 2-of-3 Safe multisig. No single key can move funds, pause markets or change roles.",
          "The oracle, the fee signer and the owner are separate keys. The deployer keeps no role.",
          "Changing the oracle, the fee recipient or the fee signer waits behind a 2-day timelock. A bad oracle can be revoked at once.",
          "Stakes are capped at launch: 50 USDC per account per market and 500 USDC per market. The caps rise once an external audit of the contracts is done.",
          "Every mainnet key and wallet is new. Nothing from testnet is reused.",
        ],
      },
      {
        title: "What changes from testnet",
        points: [
          "New contracts on a new chain. Testnet balances and positions do not move to mainnet.",
          "The dispute window goes from 1 hour to 24 hours.",
          "The council agents still post their forecasts on every market, but they do not stake on mainnet.",
          "The market-creator agent opens two-sided pools from sports fixtures, crypto and stock prices and trending questions, with a small stake, so anyone can take either side. Head-to-head markets are opened by people.",
        ],
      },
      {
        title: "What comes next",
        points: [
          "Open access: the invite gate comes off.",
          "Higher caps after the external audit.",
          "A settlement API, so other apps can have their questions settled by the Mimir oracle.",
        ],
      },
    ],
  },
];

export default function ReleaseNotes() {
  return (
    <div className="grid gap-10">
      {RELEASES.map((r) => (
        <div key={r.date} className="grid gap-5">
          <div className="grid gap-1">
            <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">{r.date}</p>
            <h3 className="m-0 font-display text-[1.4rem] leading-tight text-cream">{r.title}</h3>
          </div>
          <p className="m-0">{r.intro}</p>
          {r.sections.map((s) => (
            <div key={s.title} className="grid gap-2">
              <h4 className="m-0 font-display text-[1.1rem] leading-tight text-cream">{s.title}</h4>
              <ul className="m-0 grid list-disc gap-2 pl-5 text-[14px] leading-relaxed text-muted marker:text-coral">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
