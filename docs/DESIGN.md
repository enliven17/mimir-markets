# Design system — purple blueprint

Mimir's UI is a "blueprint" sheet: a deep violet drafting surface ruled with
thin ink lines, sharp corners, framed sections and rails that run the full
height of the page. It is the source repo's navy blueprint re-tinted to the
Solana palette, with a light and a dark theme (dark is the default).

## Tokens

Defined as RGB triplets in `app/globals.css` (`:root` = light, `.dark` = dark)
and exposed to Tailwind as `pv-*` colours in `tailwind.config.ts`, so every
utility accepts opacity (`bg-pv-emerald/10`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `pv-bg` | `#F8F5FF` | `#0E0724` | page / cell background |
| `pv-surface` | `#F1EBFF` | `#140B30` | raised surfaces, hover |
| `pv-surface2` | `#E7DDFF` | `#1B103E` | inputs, code, tracks |
| `pv-border` | `#2A1466` | `#FFFFFF` | **ink** — always use with opacity (`/25` hairlines, `/40` emphasis, `/[0.04]` fills) |
| `pv-text` | `#150A30` | `#FFFFFF` | body text |
| `pv-muted` | `#5A4A82` | `#B4A5DA` | secondary text, labels |
| `pv-emerald` / `pv-cyan` | `#7B2FE8` | `#B47DFF` | accent (Solana purple, AA-tuned) — text, lines, buttons |
| `pv-fuch` | `#9945FF` | `#9945FF` | Solana purple for fills / glows |
| `pv-gold` | `#036B4B` | `#14F195` | Solana green — money / payout figures only, use sparingly |
| `pv-danger` | `#B41A1A` | `#FF6B72` | errors, losses |
| `--pv-rule` | `#C5BDD9` | `#4A455B` | opaque ink/25 over bg (used by `.bp-cells`) |

The legacy names `emerald`, `cyan`, `fuch` all map to the purple family, so old
classes keep working. Never hardcode `black/…` or `white/…` for lines — use
`pv-border/…` so the line flips with the theme.

Contrast (WCAG AA, ≥ 4.5:1 for normal text) against `bg`, `surface` and
`surface2`: text 14.5–19.5, muted 5.9–8.7, accent 4.7–6.8, gold 5.0–13, danger 5.3–7.1. Buttons: `text-pv-bg` on `bg-pv-emerald` is 5.7 (light) / 6.8 (dark).
Faded variants (`text-pv-muted/60`) are for decoration only.

Radius: every `rounded*` step is `0` (sharp corners). `rounded-full` stays
round for dots, avatars and progress tracks. Font: Maple Mono everywhere.

Theme: the inline script in `app/layout.tsx` adds `dark` to `<html>` before
paint unless `localStorage["mimir-theme"] === "light"`; `components/ThemeToggle`
flips it. Canvas/SVG that need colours read the CSS variables
(`rgb(var(--pv-accent))` works in SVG presentation attributes; `HeroAscii`
reads them with `getComputedStyle` and re-reads on toggle).

## Layout frame

- `app/[locale]/layout.tsx` — `<main>` is the 1200px column; content sits in
  `components/PageFrame.tsx`.
- `PageFrame` — left/right rails on every page except `/` (the landing draws
  its own section borders). It pads the page to sit flush under the navbar, so
  a page that opens with a `BlueprintHeading` shares one line with the header.
- `Header` / `Footer` — framed on the same column as the rails. Nav items live
  in `components/nav-items.ts` (`NAV_ITEMS`, `NAV_CTA`); add new pages there.
  The full row shows from `xl` up, a menu sheet below that, so the list can
  grow without overflowing tablets. Active links get `aria-current="page"`.
- Use `Link` from `@/i18n/navigation` with unprefixed paths (`/arena/42`) —
  never build `/${locale}/…` by hand.

## Components (`components/BlueprintGrid.tsx`)

- `BlueprintHeading` (alias `SectionHeading`) — centred uppercase title in a
  band with full-bleed rules above and below. Props: `as` (`h1` for page
  titles, default `h2`), `eyebrow`, `subtitle`, `id`, `className`. Start every
  page with `<BlueprintHeading as="h1" …>`.
- `BlueprintSection` — heading + railed body (`bodyClassName` for padding or a
  grid).
- `BlueprintStat` — one ruled stat cell (value + mono label, `tone` accent /
  gold / text / danger). Put them in a `.bp-grid` or `.bp-cells` row.

Inside `PageFrame`, headings/sections drop their own side rails
(`.bp-page [data-bp-rails]`) so the column line stays single.

## Utility classes (`app/globals.css`)

| Class | What |
|---|---|
| `.bp-frame` | framed surface: ink hairline, page bg |
| `.bp-rails` | left/right rails only |
| `.bp-grid` + `.bp-cell` | ruled grid for **full** rows: `gap-px` over an ink background, cells paint `bg` |
| `.bp-cells` | ruled grid that tolerates a ragged last row (card feeds): each child draws a 1px ring into the gaps; pair with `border-b` (or `border`) on the container |
| `.bp-label` | mono eyebrow label |
| `.bp-paper` | faint graph-paper ruling for hero / CTA / empty states |
| `.card`, `.card-hover` | framed surface on `pv-surface` |
| `.btn-*`, `.input`, `.label`, `.chip`, `.focus-ring` | unchanged APIs, blueprint-styled |

Typical patterns:

```tsx
<BlueprintHeading as="h1" eyebrow="Oracle analytics" subtitle="…">Stats</BlueprintHeading>
<div className="bp-cells grid-cols-2 border-b border-pv-border/25 lg:grid-cols-4">
  <BlueprintStat value={12} label="Markets" />
  …
</div>
<div className="px-4 py-8 sm:px-6 lg:px-8">…page body…</div>
```

Tables: `border border-pv-border/25` wrapper with `overflow-x-auto`,
`divide-y divide-pv-border/25` rows, mono uppercase `text-pv-muted` headers.

## Avatars

`lib/avatars.ts` → `openPeepsAvatar(seed)` returns a DiceBear open-peeps URL
on a lavender background (legible in both themes). Render with
`components/ui/PeepAvatar.tsx`:

- `PeepAvatar` — `seed`, `size`, `shape` (`circle` | `square`), `tone`
  (`neutral` | `accent` | `gold`), optional `alt`.
- `PeepStack` — overlapping challenger portraits with dashed empty slots.

Seed conventions: `creator-<pubkey>`, `challenger-<pubkey>`,
`council-<persona slug>`, `oracle-mimir`.

## Hero

`components/HeroAscii.tsx` — ASCII wave field (ink → Solana purple at the
peaks), client-only via `next/dynamic`, pauses offscreen, static under
`prefers-reduced-motion`.
