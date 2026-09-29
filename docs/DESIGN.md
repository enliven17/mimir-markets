# Design system

Mimir is dark, round and pixel-voiced: warm ink surfaces, cream type, a red
accent, glass cards and scroll-driven motion. The full plan is
`docs/REDESIGN.md`; this file describes what is in the code today.

Dark only. There is no light theme and no theme toggle; tokens stay CSS
variables so one could return.

## Tokens

Hex values and `*-rgb` triplets live on `:root` in `app/globals.css`; the
triplets feed Tailwind colours (`tailwind.config.ts`), so every utility takes
an alpha (`bg-cream/10`).

| Token | Value | Use |
|---|---|---|
| `ink` | `#110f0e` | page background |
| `ink-deep` | `#0a0808` | deepest wells, code |
| `panel` | `#1c1817` | solid raised surface, menus |
| `panel-2` | `#272120` | inputs, tracks, rails |
| `panel-raised` | `#211718` | menu hover, secondary buttons, close buttons |
| `maroon` | `#4a2322` | active step fill |
| `cream` | `#f3ead6` | primary text, light buttons, segmented thumb |
| `muted` | `#a89d93` | secondary text, small labels |
| `dim` | `#7a706a` | 13px+ labels and decoration only (3.96:1) |
| `red` | `#ff2b2b` | eyebrows, live dots, accent words |
| `coral` | `#ff5148` | primary action, fills, focus ring, links |
| `coral-hi` | `#ff746c` | gradient end |
| `deep` | `#8f0e17` | gradient start |
| `danger` | `#ff938c` | errors, losses |
| `win` | `#9fd6a8` | text only: a payout the viewer received / FIRM wins |
| `pending` | `#ffb3ad` on `red/14` | pending and live pills |
| `line` / `line-strong` | cream at 12% / 30% | hairlines, hover borders |

Surfaces (CSS variables and classes): `--glass` / `.glass` (chips, ghost
buttons), `--glass-card` / `.glass-card` / `.card` (cards), `--glass-deep` /
`.glass-deep` (sheets, dialogs). `.grain` adds a fine turbulence grain overlay.
The fixed `.wall` behind the page is a 4px dot screen over a dark gradient.

Money figures are cream in Geist Mono, never green. Numbers that tick use
`font-mono tabular-nums` (Geist Pixel has no tabular figures; `.tn` boxes a
digit when it must stay pixel).

Contrast on `ink` / `panel` / `panel-2` (WCAG): cream 16.0 / 14.7 / 13.3,
muted 7.2 / 6.6 / 6.0, coral 5.9 / 5.5 / 4.9, danger 8.9 / 8.2 / 7.4,
win 11.5 / 10.6 / 9.6. Coral buttons carry an ink label (`#160909`, 6.1);
white on coral (3.2) only at 21px+ Terminal Grotesque.

### Legacy aliases

`pv-*` colours and `.bp-*` classes from the purple blueprint still exist and
now point at the tokens above (`pv-bg` = ink, `pv-surface` = panel,
`pv-surface2` = panel-2, `pv-border` / `pv-text` / `pv-gold` = cream,
`pv-muted` = muted, `pv-emerald` / `pv-cyan` = coral, `pv-fuch` = red,
`pv-danger` = danger). `components/BlueprintGrid.tsx` is deprecated. Do not
use any of them in new code; they go in P6.

## Type

| Face | Loaded by | Class | Use |
|---|---|---|---|
| Geist Pixel Square | `geist/font/pixel` (`lib/fonts.ts`) | `font-sans` / `font-body` / `font-pixel` (body default) | UI voice |
| Terminal Grotesque 400 | `next/font/local`, `app/fonts/terminal-grotesque.ttf` (SIL OFL) | `font-display` | wordmark, headings, buttons |
| Geist Mono | `geist/font` | `font-mono` | addresses, hex, live numbers |
| Geist Sans | `geist/font` | fallback only | |

Headings are never bold. Sizes are Tailwind `fontSize` tokens:
`display-xl`, `display-hero`, `display-lg`, `display-md`, `title`, `lead`,
`sub`, `body`, `card-title`, `small`, `micro`, `stat`, `eyebrow` (landing) and
`app-h1`, `app-hero`, `section`, `status`, `copy`, `meta`, `button`,
`label-xs` (app).

## Shape

Round, not sharp: `rounded-full` for every control and pill, `rounded-4xl`
(32px) sheets, `rounded-3xl` (28px) shelves and dialogs, `rounded-2xl` (22px)
cards, `rounded-xl` (20px) panels, `rounded-lg` (16px) disclosures,
`rounded-md` (12px) menus, `rounded-sm` (8px) menu items. Separate with glass
and shadow (`shadow-chip`, `card`, `sheet`, `shelf`, `menu`, `modal`,
`primary`, `bubble`, `well`), hairlines only for strips, tables and dividers.

Layout: gutter `--gut` (`clamp(16px, 4vw, 40px)`), feeds 1180px
(`--wrap`), detail and forms 920px (`--wrap-narrow`).

## Primitives (`components/ui/`)

| Component | What |
|---|---|
| `Button` (`primary`, `ghost`, `light`, `secondary`, `danger`; `sm` / `md` / `lg`), `buttonClass()` for links | pill buttons, press scale .97 |
| `Card`, `Panel`, `Sheet`, `FeedCard` (`Card.tsx`) | glass card, solid panel, focused-job sheet, glossy feed card |
| `Chip`, `StatusPill`, `LiveDot`, `Pending`, `Badge`, `Eyebrow` | pills and status language |
| `Input`, `Textarea`, `ListboxField`, `Slider` | pill / well inputs |
| `Segmented` | pill track with sliding thumb, tabs or toggles, arrow keys |
| `Disclosure` | `<details>` with a coral chevron: progressive disclosure |
| `KeyValue`, `Strip` + `StripCell`, `Progress`, `Meter` | data rows |
| `Modal` (`dialog` / `sheet`) | focus trap, Esc, return focus, Lenis paused |
| `EmptyState`, `SlotPlaceholder`, `Skeleton` | empty and loading |
| `Rail`, `Wordmark` | snap rail with round nav, gradient wordmark |

## Motion (`lib/motion.ts`, `components/motion/`)

- One Lenis instance on GSAP's ticker (`startSmoothScroll`), started by
  `MotionProvider` in the root layout; ScrollTrigger updates on Lenis scroll
  and refreshes after `document.fonts.ready` and each route change. Plugins
  register once; the instance lives on `globalThis` so HMR never adds a
  second ticker callback.
- Reduced motion: no Lenis (torn down live if the setting flips), no
  SplitText, no dither (300ms fade), no marquee, no magnetic, no hover lifts,
  numbers snap, CSS entrances off.
- Primitives: `SplitReveal` (masked line reveal), `Magnetic`, `RollingNumber`
  (with red `flash`), `Marquee` (velocity-driven ticker), `useDitherReveal`
  (ordered-dither Bayer reveal, `data-dither`), `useRiseBatch` (`data-rise` batch),
  `usePrefersReducedMotion`, `useInViewOnce`. `PageTransition` /
  `AnimatedItem` are thin `data-rise` wrappers.
- Use `useGSAP` with a `scope` for every timeline and `gsap.matchMedia()` with
  `(prefers-reduced-motion: no-preference)` in new code. Never import
  `lib/motion.ts` from a server component.
- Pre-animation states are hidden only under `html.js` and
  `prefers-reduced-motion: no-preference`; the head script adds
  `motion-timeout` after 3s as a failsafe.
- Scrollable inner areas get `data-lenis-prevent` (Lenis also runs with
  `allowNestedScroll`).
- CSS helpers: `.route-enter`, `.card-in` (stagger with `--i`), `.pop-in`,
  `.fade-rise`, `.collapse-grid[data-open]`, `.flashable`.
- Easings: `ease-out` `cubic-bezier(.23,1,.32,1)`, `ease-in-out`
  `cubic-bezier(.77,0,.175,1)`, `ease-spring` `cubic-bezier(.22,1,.36,1)`,
  `ease-overshoot` `cubic-bezier(.22,1.25,.36,1)`.

## Shell

- Header (`components/Header.tsx`): morphing glass navbar. `--nav-p` (0 → 1)
  drives height, width (1320 → 980px), radius, border, shadow, glass and
  blur (`.nav-shell` / `.nav-bar` in `app/globals.css`). Scrubbed over the
  first 160px on `/`, held at 1 on every other route, flipped at 80px under
  reduced motion. Pill: wordmark, Arena · Council · Portfolio · More, then
  Create, notifications and the wallet chip. `components/nav-items.ts` is the
  single source for the pill, the More sheet (`NavMoreMenu.tsx`), the mobile
  panel and the footer; labels live in `messages/en.json` under `nav`.
- Footer (`components/Footer.tsx`): closer on `/` only, link columns, live
  devnet slot, fine print, a climbing wordmark, and `footer/InfoModal.tsx`
  for How it works / About / Disclaimer.
- Routes: `app/[locale]/template.tsx` plays `.route-enter` and
  `components/motion/RouteEffects.tsx` lands each navigation at the top.
  `PageFrame` is the width container (`wrap` 1180, `narrow` 920).
- Wallet (`components/wallet/`): `WalletSheetProvider` (`useWalletSheet()`
  opens the sheet), `ConnectSheet` (detected Wallet Standard wallets, install
  links, phone deep links, per-row connecting / error states), `WalletChip`
  (address, balances, tier, copy, explorer, disconnect) and
  `ConnectWalletButton` for page gates. Shell code reads the wallet through
  `hooks/useMimirWallet.ts` so a kit switch touches one file.

## Accessibility

Focus is a 2px coral outline with a 3px offset everywhere. Selection is red
on cream. Every text pair used for body copy meets AA on the three surfaces
above; `dim` is for 13px+ labels and decoration.

## Landing (`app/[locale]/page.tsx`, `components/landing/`)

A server page composing client sections around one arena feed
(`LandingFeed.tsx`: `GET /api/arena/claims` on mount, polled every 15s while
the tab is visible; sections read `status` for loading / empty / offline).
Pure selectors live in `lib/landing.ts` (tested in `tests/node/landing.test.ts`).
Styles are the `l-*` classes in `components/landing/landing.css`. Every number
is real; nothing falls back to a made-up value.

1. **Hero**: `Don't argue. Settle.` dithers in, a pixel scribble draws under
   the accent word, one line of copy, two magnetic CTAs, the slim ASCII field
   (`components/HeroAscii.tsx`) behind; the copy drifts up on scroll.
2. **Live strip + ticker**: markets, open pool and live on the ER (numbers roll
   up once in view and flash on change), then a velocity marquee of the newest
   claims.
3. **How it settles**: pinned, scrubbed, snapping timeline over four steps with
   a rolling numeral and a filling path.
4. **One claim**: a real live claim as an inspector card.
5. **Council dial**: pinned; scrolling turns "Stake a side" into "Let the
   council decide" (real roster from `/api/council/roster`).
6. **Ledger**: the last settled claims on a snap rail, tagged Firm /
   Contested / Refund.

The footer's closer is the page's only closing CTA. `EdgeFog` blurs the
viewport edges while the page moves.

Pinned layouts exist only while their timeline sets `data-pinned` /
`data-dial`, so the server HTML, no-JS and reduced motion get plain stacked
sections. Pinned sections sit inside a wrapper `div` so GSAP's pin spacer is
never a React sibling, and every section stays mounted through loading.
Sections that change height call `requestScrollRefresh()`. Avoid
`position: sticky` on the landing (the body's `overflow-x` clip breaks it);
use a pin.
