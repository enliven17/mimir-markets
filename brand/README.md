# Mimir brand

| File | Use | Size |
|---|---|---|
| `x-profile.png` | X avatar; circle-safe (the mark sits inside the middle 70%) | 800×800 (upload as is, X shows 400×400) |
| `x-banner.png` | X header; copy upper left, clear of the avatar in the lower-left corner | 3000×1000 (X's 1500×500 at 2×) |

Colours and type follow `docs/DESIGN.md`: ink `#110f0e`, cream `#f3ead6`, red `#ff2b2b`, coral `#ff5148`; Terminal Grotesque for the display lines, Geist Pixel Square for body copy, Geist Mono for labels (licences in `source/fonts/`). The ASCII wave field and the scribble under "Settle." are still frames of the landing hero's own pieces (`source/parts.js`).

## Images

Plain HTML in `source/` (open them in a browser to edit), exported by headless Edge:

```sh
cd brand
npm install
npm run render     # → x-profile.png, x-banner.png
```

Set `CHROME_PATH` to use another Chromium browser.
