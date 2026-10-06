# TODO: swap the Arc Showcase entry to this repo (when Arc support lands)

Status (2026-10-06): **waiting on Arc support.** This repo is Solana-only right now: there is no Arc code in it.
The Arc Showcase entry (arc-oss / arc-showcase.thecanteenapp.com, via the `arc-canteen` CLI) still points at the
old repo, `enliven17/mimir`, which is the Arc build (x402 nanopayments, Arc testnet, Circle). The showcase asks
for Arc primitives other Arc builders can reuse, so the entry moves here only once this repo actually runs on Arc.

## When Arc support is in this repo

1. **Rename the repo** `enliven17/mimir-solana` → `enliven17/mimir-markets`
   - `gh repo rename mimir-markets --repo enliven17/mimir-solana` (GitHub redirects the old URL)
   - `git remote set-url origin https://github.com/enliven17/mimir-markets.git`
   - Update links that name the old repo: `cli/README.md` (docs/AGENTS.md link), `cli/package.json` (repository, if set),
     README badges, `brand/reply-agent-rails.txt`.
2. **Push** `main` so the public repo has the Arc code.
3. **Resubmit the showcase**: `arc-canteen submit-showcase` (upgrade first: `uv tool upgrade arc-canteen`).
   Resubmitting replaces the entry (the server keeps the latest submission). No `~/.arc-canteen/showcase.yaml` on this
   machine, so the form starts empty. Fields:
   - Main repo: `https://github.com/enliven17/mimir-markets`
   - Live site: `https://mimirmarkets.xyz`
   - Standalone infra repo (optional): only if the reusable Arc pieces get their own repo (the showcase calls this a bonus)
   - Pitch ("why choose you, which primitives do you expose vs circlefin/arc-*"): write it from what is actually in the repo
     then (the agent API, the AI oracle with verify hashes, x402 / USDC flows on Arc), not from this note.
   - Both affirmations: the live site stays live, the repos stay open source.
4. **Log it**: `arc-canteen update-product` with what changed (Mimir now runs on Solana and Arc from one repo).
5. **Brand**: in `brand/source/networks.html`, give the Arc card a `MAINNET` pill if Arc is on mainnet by then
   (it says `BY CIRCLE` now on purpose), re-render with `node render.mjs networks`, and check `brand/networks.txt`.

Delete this file once all of the above is done.
