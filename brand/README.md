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

`daily-video/` is the first daily clip, built in the same system as the launch video and reusing its pieces (dither, field, scribble, rolling numbers, claim card, wells); it is its own ft-motion project (`project.json` at 1080×1080, 60 fps, 12 s, 120 BPM, its own `scene.js` with every time on the beat grid in `T`, a shorter `sound.py` that mirrors it, and copies of the fonts, the horn and five wallet portraits so it renders on its own). Render it from an ft-motion checkout like the launch cut: `cp -r ../mimir-solana/brand/daily-video examples/mimir-daily-01`, `python examples/mimir-daily-01/sound.py`, a draft with `node ft.mjs render examples/mimir-daily-01 --sub 1`, then the final with `node ft.mjs render examples/mimir-daily-01` and `ffmpeg -i examples/mimir-daily-01/out/mimir-daily-01.mp4 -c:v copy -c:a aac -b:a 192k -movflags +faststart ../mimir-solana/brand/daily-01.mp4`. The claim, wallets, stakes, latencies, price, confidence and hash are illustrations; the 2 USDC bond, the 24h window, the zero fee on the MagicBlock Ephemeral Rollup and Solana devnet are the product's. For the next one, copy the folder, change `COPY` and the claim at the top of `scene.js`, bump `name` in `project.json` and keep `sound.py` in step with `T`.
