# October 26 update — verification

Verified locally and in production on October 26, 2026. This is a deployment verification record, not an external
audit of the contracts.

| Check | Result |
|---|---|
| `npm run test:smoke` | **983 passed**, 0 failed |
| `npx tsc --noEmit -p . --pretty false` | Passed |
| `npm run build` | Passed, production build generated |
| `npx convex codegen --typecheck disable` | Bindings regenerated successfully |
| Convex production deploy | Passed to `hushed-orca-915.convex.cloud`; additive schema/index changes and functions deployed |
| Vercel production deploy | Passed; deployment `dpl_BY4tWH6TinonnY5bAABcvtcSueD7`, alias `mimirmarkets.xyz` |
| Live route checks | `/en/docs`, `/en/radar`, `/og/product-update-2026-10.png` and `/sitemap.xml` returned 200; unauthenticated `/api/demo` returned the expected 401 |
| `npx playwright test tests/e2e/product-update.spec.ts tests/e2e/demo.spec.ts --project=desktop --project=mobile --workers=2` | **42 passed** |
| `git diff --check` | Passed |
| `node brand/product-update-2026-10/render.mjs` | Seven 1600×900 images and a contact sheet rendered; eight thread posts and three standalone posts fit the weighted 280-character check |

The browser suite runs against the local production build. Its chain/backend inputs and wallets are fixtures;
it does not fund, sign or broadcast a real transaction. It covers public records and pending-fill exclusion,
7/30/90-day selection, radar controls, existing checkpoint discovery, the resolution timeline, paired trials,
preview wallet isolation, all three preview networks, quotas, basket controls and preview → live review.
Desktop/mobile screenshots were captured; the campaign contact sheet and representative product screens were
visually inspected for clipping and readability. The broader WebKit suite was not run for this update.

The added backend regressions execute actual Convex handlers against an in-memory indexed database with failed
mutation rollback. They cover cross-agent reservations, aggregate signal liquidity, ambiguous-buy reservations,
partial-sale cost/receipt idempotency, follow ownership and private-market exclusion, forecast attempt budgets,
side/evidence changes without staking, paired-trial ownership/quota and model inheritance. Model requests are
mocked; tests verify the pinned model remains selected after the default changes.

The new auth/input/data-projection paths were reviewed using the
[OWASP Security Check skill](C:/Users/enliven/.agents/skills/owasp-security-check/SKILL.md): signed changes bind the
action and body, fresh signatures are replay checked, private reads verify ownership, trial ownership is checked
inside the backend, and public projections omit secrets and private market questions. This review is scoped to
the update; it is not a substitute for a production security assessment.

Two material implementation details are deliberate:

- The performance metric is realized-PnL drawdown, not historical portfolio equity drawdown. Historical equity
  marks are unavailable, and the UI/release copy names this distinction.
- Copy controls apply to recorded Solana costs and realized copy receipts. Arc retains its separate per-stake
  cap, and unrealized losses are not capped by these new realized-loss controls.

Production wallet/RPC behavior, hardware passkeys, mainnet deposits and live provider availability remain ongoing
operational checks. No contract deployment, role change, token operation, fund movement or social post was performed.
Existing unrelated worktree files were left in place.
