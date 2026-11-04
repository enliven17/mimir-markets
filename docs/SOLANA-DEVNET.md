# Solana Devnet operations

## Pinned identity

| Setting | Value |
|---|---|
| Cluster | Solana Devnet |
| Genesis | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Program | `EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE` |
| USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Devnet operator | `J98R1EtNppvAFPXrviBUhFZbxoDpTCL7vjBwDRxVpKyk` |
| Convex production | `warmhearted-hummingbird-752` |
| Convex development | `posh-tiger-261` |

The branch reuses the existing V3 devnet program. A chain genesis check precedes signing. Convex's deployment binding refuses a different program, mint or genesis. Indexed USDC amounts use 18 decimals; native SPL instructions use six decimals exactly. Public keys remain case-sensitive.

## Workers

| Job | Interval |
|---|---|
| Indexer | 30 seconds |
| Oracle | 2 minutes |
| Council | 15 minutes |
| Creator | 1 hour |
| Hosted agents | 5 minutes |

Only production runs chain-writing workers. Keep `MIMIR_BACKEND_OFF=1` on development. Production uses `MIMIR_BACKEND_OFF=0`, `LAUNCH_SOLANA=1`, its own shared secrets, encrypted-wallet key and Gemini configuration. Supply `SOLANA_KEYPAIR_JSON` to Convex only, using the existing operator identity. Oracle and web roles use separate provider keys. Never copy operator credentials to Vercel.

Worker leases prevent overlapping executions. Agent trading, owner withdrawals and copy execution share per-wallet spending leases. The creator is capped at two new 2-test-USDC markets per day by default. Council evaluation considers at most three decisions per tick and caps a stake at 2 test USDC. Hosted agents obey their signed owner's limits.

`GET /api/health` checks worker state and freshness. The indexer reads confirmed native state, tracks actual signatures and records their execution layer. Proposed claims finalize after their dispute window; expired unresolved claims follow refund rules. Cancelled claims have no remaining creator payout. Refundable bond state is distinct from a held bond.

## Publish and verify

Deploy backend changes from this branch into the dedicated Solana project with strict type checking. Bind a new backend before enabling workers. Set Vercel's production branch to `solana`, with the production Convex URL and web-only secrets. Both `.gitignore` and `.vercelignore` exclude environment files.

DNS for `solana.mimirmarkets.xyz` is an `A` record named `solana` pointing to `76.76.21.21`. Keep the apex/Base domain records as configured. Verify the deployed pages, native wallet sheet, market data and health endpoint after a publish.

Run `npm run check:solana` for a read-only chain check, `npm run test:solana` for native/security tests, and Playwright's page-render checks on desktop, mobile Chromium and WebKit. `scripts/solana/test-api-call.ts` inspects a native quote without sending by default. Its `--send --keypair <local file>` mode transfers one small test-USDC payment and checks answer/replay behavior. Use it only for an explicitly requested integration test.

The standalone Android APK in the Base branch targets the primary site. This branch offers the installable web app until a dedicated native build exists.
