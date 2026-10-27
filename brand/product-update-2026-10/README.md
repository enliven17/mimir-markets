# Mimir product update — X publishing package

Prepared for publication **after backend + web deployment and live verification**. These files do not publish
anything. No account was contacted and no post was sent.

Recommended: one **8-post English thread with 7 images**. Attach one image to posts 1–7; post 8 holds the links.
[`thread-en.txt`](thread-en.txt) contains copy in publishing order. [`campaign.json`](campaign.json) is the editable
source, including per-post image assignments. All posts were checked against a conservative 280-character count,
with URLs weighted as 23 characters.

| Post | Image | Alt text |
|---|---|---|
| 1 | [01-cover.png](01-cover.png) | Mimir product update: public records, copy limits, Strategy Lab, Council radar, holder benefits and daily checkpoints. |
| 2 | [02-record.png](02-record.png) | Public execution record with 7, 30 and 90-day periods, realized PnL, return on closed cost, open cost and explorer verification. |
| 3 | [03-copy.png](03-copy.png) | Three agents feed into one shared token cost cap, with price, signal age and liquidity checks before new copy buys. |
| 4 | [04-lab.png](04-lab.png) | Example paper-test variants use 10% and 20% stop losses, with equal starting funds and separate settings fingerprints. |
| 5 | [05-radar.png](05-radar.png) | Council radar compares recorded forecast directions and offers updates for new views, side changes and approaching deadlines. |
| 6 | [06-benefits.png](06-benefits.png) | Preview per-agent daily AI caps: Standard 6, Holder 8, Backer 10, Oracle Circle 12; global limits still apply. |
| 7 | [07-markets.png](07-markets.png) | Daily SOL and BTC checkpoints at 12:00 UTC: opening and staking, evidence checkpoint, proposal and dispute, final outcome. |
| 8 | None | Preview, radar and release-notes links. |

Alternative: **3 standalone posts**, each with 2 images, in [`standalone-en.txt`](standalone-en.txt). These reuse
the six feature images. Choose this format instead of the thread, or use them later as feature explanations.
The cover is optional for a separate announcement; the supplied three-post plan does not need it.

Suggested thread order is already in the file. If posting separately, use agent records/copy first, Strategy Lab
second, radar/checkpoints third. Timing is an editorial choice; no engagement claims are made.

All seven images are 1600×900 PNGs. [contact-sheet.png](contact-sheet.png) previews the complete set. The graphics
are editorial diagrams with no fabricated PnL, volume, users or token-price claims. A/B percentages are explicitly
example settings, not returns. Review and adjust announcement tense if deployment is still pending.

The standalone Mimir Launch visual is [08-mimir-launch.png](08-mimir-launch.png), exported from the existing brand-language HTML; the English caption and alt text are in [`mimir-launch-en.txt`](mimir-launch-en.txt).

The AI infrastructure post is [09-ai-infrastructure.png](09-ai-infrastructure.png); its English caption and alt text are in [`ai-infrastructure-en.txt`](ai-infrastructure-en.txt).

The release-notes link also has a dedicated 1200×630 Open Graph / X large-image card at
[`public/og/product-update-2026-10.png`](../../public/og/product-update-2026-10.png), generated from
[`release-card.html`](release-card.html). `/en/docs` and `/en/docs#release` use the same card because URL fragments
are not sent to the server. The docs page declares both `og:image` and `twitter:image` explicitly.

To reproduce locally:

```powershell
node brand/product-update-2026-10/render.mjs
```

The renderer uses the existing brand fonts and installed Edge (or `CHROME_PATH`), checks text limits and layout
overflow, and writes the PNGs plus text files. It does not change the existing brand renderer or older campaigns.
