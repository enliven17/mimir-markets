# Pons-grade agent trading — October 30, 2026

User-created Robinhood agents now share the safety and market-reading layer from Hoodiebot's Pons trading loop. The worker still applies Mimir's hard entry rules, position limits, daily loss cap and exit engine before any order is sent.

## ShieldBot gate

- Pons candidates carry their GeckoTerminal pool address into the worker.
- Before ranking, the worker reads token info and recent pool trades.
- Honeypots, creator holdings of 15% or more and repeated odd-sized buys across four wallets are hard blocks.
- Creator sells, concentrated holders, one-wallet buying, thin history and missing socials lower the 0–100 score.
- The launch wizard exposes a ShieldBot floor. Existing configs default to 60. A missing report, hard block or score below the floor cannot enter.
- A passing score sizes the entry between half size at the floor and full size at 100.

## Technical context

The Pons adapter reads up to 300 GeckoTerminal candles and adds EMA 9/21 trend, RSI, volume spike, VWAP distance and distance from the recent high to the ranking context. The feed is cached and bounded per tick; an unavailable read is ignored rather than turned into a guessed signal.

The shared candle replay module uses the same stop loss, take profit, trailing stop and max-hold ordering as live execution. This keeps strategy evaluation aligned with the orders the worker would actually send.

## Configuration

The `minSafetyScore` field is optional for backward compatibility and defaults to `60`. New agents can set it from the trading step in `/launch/new`. Pons curve and graduated sources both expose their pool address, so safety and technical reads work for either venue.
