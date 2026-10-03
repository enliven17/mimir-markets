# Mimir brand

| File | Use | Size |
|---|---|---|
| `x-profile.png` | X avatar: the horn over the wave field; circle-safe (inside the middle 70%) | 800×800 (upload as is, X shows 400×400) |
| `x-banner.png` | X header; copy upper right, only the wave field in the lower-left corner behind the avatar | 3000×1000 (X's 1500×500 at 2×) |
| `logo/mimir-horn.svg` | the logo: Mimir's horn, cream with red linework; for dark backgrounds | vector (~300KB, use PNGs for small sizes) |
| `logo/mimir-horn-red.svg` | the horn in red with coral linework | vector |
| `logo/mimir-horn-tile.svg` | the cream horn on a rounded ink square | 1024×1024 |
| `../app/icon.png`, `../app/apple-icon.png` | the site's tab icon and iOS home-screen icon, rendered from `source/icon.html` | 256×256, 180×180 |
| `launch.mp4` | launch post: "Don't argue. Settle." over the wave field, then one claim card walks Create → Challenge (stakes streaming in on the rollup, zero fee, ~30 ms) → deadline → Resolve (the oracle reads the evidence, proposes "No" at 91% with a verify hash, 24h dispute window with a bond; the 20 council jurors vote) → Payout (winners pull), then the horn, the slogan and `mimirmarkets.xyz`. Sources in `launch-video/` | 1920×1080, 20 s, 60 fps, with sound |
| `launch-square.mp4` | the same cut laid out for phone feeds | 1080×1080, 20 s, 60 fps, with sound |
| `daily-01.mp4`, `daily-01.txt` | daily X post 01, "What is Mimir?": the hook ("Every argument online ends the same way." → "Nobody settles it."), "Don't argue. Settle." with the scribble, three beats (stake a side on the claim card; AI agents challenge it at zero fee on the rollup; the AI oracle stamps "No." with confidence, a verify hash and the 24h dispute window with a 2 USDC bond), then the horn, "Mimir." and `mimirmarkets.xyz`; the on-screen words are the caption track, so it reads without sound. The `.txt` is the post copy. Sources in `daily-video/` | 1080×1080, 12 s, 60 fps, with sound |
| `daily-01-wide.mp4` | the same clip laid out for 16:9: the headline under its rolling numeral on the left (the two-line beats broken into three lines), the card and its panels on the right, the hook, slogan and end card centred | 1920×1080, 12 s, 60 fps, with sound |
| `daily-02.mp4`, `daily-02.txt` | daily X post 02, "Hold $MIMIR.": the hook with the scribble under the ticker and the mint (`8r2L…jd4V`, Solana mainnet), three beats on what holding does in the product today (the Holder / Backer / Oracle circle tiers at 10k / 1M / 10M $MIMIR, or 100 $ANSEM for Holder, giving 2× / 4× / 8× council reasoning and preflight limits; holders pass the agent registration and basket gates where they are switched on; 25% of the ClawPump creator fee share buys $MIMIR back, $MIMIR price claims settle from DEX prices, no yield or price promises), then the horn and "Mainnet is coming." The `.txt` is the post copy. Sources in `daily-02-video/` | 1080×1080, 13 s, 60 fps, with sound |
| `daily-02-wide.mp4` | the same clip laid out for 16:9, like `daily-01-wide.mp4` | 1920×1080, 13 s, 60 fps, with sound |
| `arch.mp4`, `arch.txt` | architecture video in two acts. "How Mimir works today.": the stack builds layer by layer (traders and agents; the Next.js app; the MagicBlock Ephemeral Rollup with ~30 ms zero-fee challenges; the Anchor V3 program with the USDC vault, the 24h 2 USDC bonded dispute and pull payouts; the AI workers: oracle, market creator, 20-persona council, indexer to Neon; the data they read and the Gemini → Groq → OpenRouter LLM chain) with packets on the connectors. "Next: Jev.": a planned layer of typed, calibrated decisions from TypeSafe AI's decision model with three hookups (oracle second opinion, council stakes, moderation and claim quality) and the /calibration note, marked as coming next throughout; then the horn and "Mimir × Jev. Coming soon." The `.txt` is the post copy. Sources in `arch-video/` | 1920×1080, 28 s, 60 fps, with sound |
| `daily-03.mp4`, `daily-03.txt` | daily X post 03, "What is the AI oracle?", in a different grammar from the earlier clips: kinetic type for the hook ("Who decides who was right?" → "An AI oracle. With receipts."), ASCII-field wipes between scenes, then one camera move across a wide evidence canvas (the claim at its deadline; the safe fetch of its source; the resolver rule and two price readings, refund when they straddle the line; an LLM reading a claim with no rule, with the 80+ FIRM / 60-79 CONTESTED / under 60 refund tiers; the sealed bundle, its sha256 on chain and /verify), a terminal strip typing the oracle's steps, and a timeline scrubber that takes over for propose → 24h dispute with a 2 USDC bond → final → payouts; end card with the horn and the slogan. The `.txt` is the post copy. Sources in `daily-03-video/` | 1920×1080, 19 s, 60 fps, with sound |
| `telegram.mp4`, `telegram.txt` | the Telegram launch post, in a grammar of its own (flat colour blocks and hard cuts, no ASCII field or dither): a 1,000-dot grid fills on cream while a 48-hour clock runs; a full-bleed red "1,000" and "users in 48 hours."; on ink, a phone swings in and numbered step chips walk the bot (/start with the launch video, link wallet with one signature, the new-market alert, /bets, "You won.", /price, Open Mimir as a Mini App); a cream end card with the red horn and @mimirmarketsbot. The user count is the team's figure; the wallet, markets, stakes, payout and token price are illustrations. The `.txt` is the post copy. Sources in `telegram-video/` | 1920×1080, 20 s, 60 fps, with sound |
| `launch-thumb.jpg` | the 16:9 thumbnail the Telegram bot sends with `launch.mp4` (a frame of its end card) | 320×180 |
| `logo/mimir-mark.svg` | alternate mark: cream M, red period | vector |
| `logo/mimir-mark-mono.svg` | the M. mark in one colour (`currentColor`) | vector |
| `logo/mimir-mark-tile.svg` | the M. mark on a rounded ink square | 1024×1024 |

Colours and type follow `docs/DESIGN.md`: ink `#110f0e`, cream `#f3ead6`, red `#ff2b2b`, coral `#ff5148`; Terminal Grotesque for the display lines, Geist Pixel Square for body copy, Geist Mono for labels (licences in `source/fonts/`). The mark's outlines are the display face's own M and period (extracted with fontTools, no hand redraw). The ASCII wave field and the scribble under "Settle." are still frames of the landing hero's own pieces (`source/parts.js`).

## Images

Plain HTML in `source/` (open them in a browser to edit), exported by headless Edge:

```sh
cd brand
npm install
npm run render     # → x-profile.png, x-banner.png, ../app/icon.png, ../app/apple-icon.png
```

Set `CHROME_PATH` to use another Chromium browser.

## Launch video

Made with [ft-motion](https://github.com/imserhatdemir/ft-motion): every frame is `draw(ctx, t)` in Canvas 2D, rendered in headless Chrome/Edge with motion blur, encoded by ffmpeg, and scored by a Python synth on the same 120 BPM grid (one bar = 2 s). The project is `launch-video/`:

| File | What |
|---|---|
| `project.json` / `project.square.json` | canvas (1920×1080 / 1080×1080), 60 fps, 20 s, 120 BPM, fonts |
| `scene.js` | the scene; copy and the illustrative claim at the top, every time on the beat grid (`T`) |
| `sound.py` | the soundtrack; its times mirror `T` in `scene.js` |
| `fonts.css`, `fonts/` | Terminal Grotesque, Geist Pixel Square, Geist Mono (licences alongside) |
| `horn.svg`, `avatars/` | the logo; the council's open-peeps portraits (seed `council-<slug>`, the site's palette) and eight wallet portraits |

The pieces are the site's: tokens from `app/globals.css`, the ASCII field from `components/hero-ascii/field.ts`, the scribble from `components/landing/Scribble.tsx`, the Bayer dither from `components/motion/useDitherReveal.ts`, the rolling step numeral from `components/landing/HowItSettles.tsx`, the card and odds bar from `components/arena/ClaimCard.tsx` and `OddsBar.tsx`, the roster from `agents/council/`. The claim, wallets, stakes, latencies, price, confidence and hash are illustrations, not live data.

ft-motion scenes import its engine by relative path (`../../engine/core.js`), so render from an ft-motion checkout (Node 18+, Python 3.10+ with numpy and scipy, ffmpeg on `PATH`, Chrome or Edge):

```sh
git clone https://github.com/imserhatdemir/ft-motion ../../ft-motion && cd ../../ft-motion && npm install && pip install -r requirements.txt
cp -r ../mimir-solana/brand/launch-video examples/mimir-launch
python examples/mimir-launch/sound.py              # → out/audio.wav (prints LUFS / true peak)
node ft.mjs sheet examples/mimir-launch 16         # contact sheet to check the frames
node ft.mjs preview examples/mimir-launch          # live player (space, ←/→, b = motion blur)
node ft.mjs render examples/mimir-launch           # → examples/mimir-launch/out/mimir-launch.mp4

# the square cut: same scene, the square project file
cp -r ../mimir-solana/brand/launch-video examples/mimir-launch-square
cp examples/mimir-launch-square/project.square.json examples/mimir-launch-square/project.json
python examples/mimir-launch-square/sound.py && node ft.mjs render examples/mimir-launch-square

# into the brand folder, audio at 192 kbps
ffmpeg -i examples/mimir-launch/out/mimir-launch.mp4 -c:v copy -c:a aac -b:a 192k -movflags +faststart ../mimir-solana/brand/launch.mp4
ffmpeg -i examples/mimir-launch-square/out/mimir-launch-square.mp4 -c:v copy -c:a aac -b:a 192k -movflags +faststart ../mimir-solana/brand/launch-square.mp4
```

A full render takes a while (1200 frames × 6 motion-blur subframes); `--sub 1` renders a quick draft.

## Daily videos

`daily-video/` is the first daily clip, built in the same system as the launch video and reusing its pieces (dither, field, scribble, rolling numbers, claim card, wells); it is its own ft-motion project (`project.json` at 1080×1080 and `project.wide.json` at 1920×1080, both 60 fps, 12 s, 120 BPM; `scene.js` picks its layout from the canvas size, its own `scene.js` with every time on the beat grid in `T`, a shorter `sound.py` that mirrors it, and copies of the fonts, the horn and five wallet portraits so it renders on its own). Render it from an ft-motion checkout like the launch cut: `cp -r ../mimir-solana/brand/daily-video examples/mimir-daily-01`, `python examples/mimir-daily-01/sound.py`, a draft with `node ft.mjs render examples/mimir-daily-01 --sub 1`, then the final with `node ft.mjs render examples/mimir-daily-01` and `ffmpeg -i examples/mimir-daily-01/out/mimir-daily-01.mp4 -c:v copy -c:a aac -b:a 192k -movflags +faststart ../mimir-solana/brand/daily-01.mp4`. For the wide cut, copy the folder again as `examples/mimir-daily-01-wide`, copy its `project.wide.json` over `project.json`, run its `sound.py` and render it the same way into `daily-01-wide.mp4`. The claim, wallets, stakes, latencies, price, confidence and hash are illustrations; the 2 USDC bond, the 24h window, the zero fee on the MagicBlock Ephemeral Rollup and Solana devnet are the product's. For the next one, copy the folder, change `COPY` and the claim at the top of `scene.js`, bump `name` in `project.json` and keep `sound.py` in step with `T`.

`daily-02-video/` is the second clip, a copy of `daily-video/` with its own copy, beats, timing (`T`, 13 s) and `sound.py`; it renders the same way (`examples/mimir-daily-02` with `project.json`, `examples/mimir-daily-02-wide` with `project.wide.json` copied over `project.json`) into `daily-02.mp4` and `daily-02-wide.mp4`. Its numbers are the product's: the tier thresholds and multipliers from `lib/token-tiers.ts`, the gates from `docs/HACKATHON.md` "Token utility", the 25% buyback of the creator fee share from the token launch; the agent, its owner wallet, its balance and the basket are illustrations.

## Architecture video

`arch-video/` is a 1920×1080 project (`project.json`, 28 s, 120 BPM, times in `T` in `scene.js`, mirrored by `sound.py`). Copy it as `examples/mimir-arch`, run its `sound.py`, render with `--sub 1` for a draft and without it for the final, and mux into `arch.mp4` with the same ffmpeg line as above. Act 1's labels follow `README.md`, `docs/SOLANA.md`, `docs/COUNCIL.md` and the code (`lib/llm.ts` for the fallback chain, `lib/solana/config.ts` for the 2 USDC bond). Act 2 is a plan, not a shipped feature: every Jev element carries "planned" or "coming next", and its probabilities and score are illustrations.

`daily-03-video/` is a 1920×1080 project only (`project.json`, 19 s, 120 BPM; `scene.js` keeps every time in `T`, mirrored by `sound.py`). Render it like the others as `examples/mimir-daily-03` into `daily-03.mp4`. Its steps and numbers follow the oracle's code: the order in `agents/oracle/decide.ts`, the tiers (80+ FIRM, 60-79 CONTESTED, under 60 refund), the resolver specs in `lib/resolver-spec.ts`, the two-source cross-check in `lib/price-consensus.ts`, the safe fetch in `lib/research/gateway.ts`, the bundle in `lib/verdict-bundle.ts` and the 2 USDC bond in `lib/solana/config.ts`. The claims, prices, article, confidence and hash on screen are illustrations.
