# Base Sepolia rollout

The Solana/Robinhood removal and Base/Arc migration comes from `ccr-e1f759c7-alijkt` (`c216919`). Base is now the only enabled market chain. Arc contracts, wallets and indexed history remain available for a later rollout.

The [November 2 security update](releases/base-contract-security-2026-11-02.md) changes the Base VS private-entry
authorization and both markets' paused-proposal refunds. The November 1 addresses below predate those fixes.
Deploy fresh VS and pool contracts and use a fresh backend/index binding before treating the fixes as active;
the existing deployment binding cannot be reset or rebound. Switch the frontend/backend configuration together
and preserve the legacy settlement path for existing positions. Existing contracts have no upgrade path;
editing source does not change their behavior.

## Deployed on 2026-11-01

- Chain: Base Sepolia, **84532**; RPC `https://sepolia.base.org`.
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals).
- MimirFees: `0xd3356F1a085068b2DA2dfE1A09f1e8ddf0eC0858`.
- MimirV3Erc20: `0xB29BCcA174B78bE6448234c94Bf1caab44824948`.
- MimirPoolErc20: `0x9d3721dc087103228a4bA9EC72dacEb1B19b4402`.
- First block: **53107125**; minimum gross stake **0.1 test USDC**.
- Dispute window: **60 seconds**, for testnet lifecycle checks. Mainnet requires at least 86400 seconds and separate Safe roles.
- Testnet owner/arbiter/treasury/signer: `0x29C1B32CB675A0B27E87289c7f8E1eFDA2b85108`.
- Oracle: `0x651216ed682cDaa06EfaAc332AaD7a7Bc9f4F7c4`, the existing shared oracle address; funded with test ETH.
- Convex: `hushed-orca-915`; Vercel project: `mimirclaw`.

Addresses repeat across chains. In particular, the Sepolia fees address equals an existing Base mainnet payment contract address. Always check **chain 84532** before interacting.

## Verification

`forge test` passed all 215 tests, including ERC-20 transfers, permits, dispute bonds, refunds, blacklisted recipients and escrow invariants. Deployed runtime sizes are 23853 bytes for VS and 16554 bytes for pool, below EIP-170.

The real Sepolia smoke test (`scripts/base/smoke-markets.mts`) opened pool 1, staked on its other side with a USDC EIP-2612 permit, rejected a non-oracle resolution, proposed and finalized the outcome, and paid the winner. VS 1 was opened, cancelled and refunded:

- Pool create: `0x1bddd3aa39dedc2b289091ee19588e514740299f808caaf2f927bb45aae1d8f1`.
- Permit stake: `0x15d57e83f60b965374a888553e528cc16ee0fb5619a13dc9cf7d836f7cf00c78`.
- Oracle proposal: `0x1b91ae261dc2b45cc15fbb7e6f72bd03e1e8771694fa4122ee3fe440d178ce15`.
- Finalize: `0x879116e43c4a39b5121a70aee5672f633fb2b39513a7667e622fdfe6d49ce0b9`.
- Winner payout: `0xa6038a5dee2bcc6937c80ea905b1a764bc8ea7fc932c30be0382044eff00e610`.
- VS cancellation/refund: `0x6cfb16f18c252fdcfb5a52161e7127616a4a588964f66a7107f512feafbfadad`.

All twenty council wallets have 0.5 test USDC and 0.00005 test ETH; the creator wallet has 5 test USDC and 0.00005 test ETH. The shared daily creator budget is 1 test USDC, with 0.1 test USDC seed stakes. Circle uses sandbox credentials for this rollout. Council public data keeps mainnet and Sepolia wallets separately.

Application validation: 591 Node tests, TypeScript and production build passed. Desktop/mobile browser checks cover 93 cases (three device-specific cases are skipped); corrected selectors were rerun successfully. The indexer was verified against the deployed contracts, including the public Sepolia RPC's 200-block log-range limit. The creator opened Base pools 2 and 3 through Circle wallets.

The dependency audit has no critical advisories; 19 high-severity advisories remain in the existing wallet dependency tree and should be addressed before mainnet acceptance.

Paid calls and Clanker token creation remain unavailable during testnet: those integrations use mainnet contracts. They must not send users to mainnet from a Sepolia staking flow.

## Operations and Arc reactivation

The site builds with `NEXT_PUBLIC_MARKET_CHAINS=base`, `NEXT_PUBLIC_DEFAULT_MARKET_CHAIN=base` and `NEXT_PUBLIC_BASE_NETWORK=testnet`. Convex uses `MARKET_CHAINS=base`, `DEFAULT_MARKET_CHAIN=base`, `BASE_NETWORK=testnet` and the `MIMIR_BASE_*` deployment values. Public settings require a Vercel rebuild.

`chainMigrate:run` backfills old records with `chain=arc`, idempotently. The rollout preserved 44 Arc markets, 49 positions, 259 events, 39 verdicts and related oracle/council records. A complete pre-migration Convex snapshot and environment backups are in the release worktree's ignored `.temp/` folder; never commit them.

To re-enable Arc, first verify its network, RPC, contracts, oracle role and funded Circle wallets. Circle credentials must match the selected networks; restore mainnet credentials when moving both chains to mainnet. Then set `MARKET_CHAINS=base,arc` in Convex and `NEXT_PUBLIC_MARKET_CHAINS=base,arc` in Vercel and rebuild. The two indexers and shared oracle/council/creator/twin jobs will use the enabled chains. Keep Base as the default unless intentionally changing it.

`MIMIR_BACKEND_OFF=1` pauses automated jobs during maintenance. Telegram event publishing is disabled for the testnet rollout to avoid posting test transactions to live subscribers.

## Mainnet comes later

The newer deployment guard requires a binding for every enabled chain. Keep archived Arc mainnet dormant in this Sepolia backend. Reactivate Arc mainnet in the isolated Base mainnet backend instead, using the binding/reindex steps in [BASE-MAINNET.md](BASE-MAINNET.md). Do not use testnet adoption to relabel Arc mainnet history.

Deploy fresh Base mainnet contracts after testnet acceptance. Use the strict role checks, Safe owner/arbiter, distinct oracle and signer, at least a one-day dispute window, mainnet USDC, and reviewed caps. Switch the site, Convex contracts, first block, RPC, Circle credentials and wallets together. Testnet balances and history must never be interpreted as mainnet funds.

## Audited contracts with audit agent (2026-11-04)

Fresh Base Sepolia deployment of the audit-fix contracts (deposit-only refunds, `auditAgent`), dispute window 900 s. Not wired to the testnet site; its Convex binding stays on the contracts above.

- MimirFees `0x48ecdFDfcDa265Fcf44256e75a42eA7ba3e2531D`, MimirV3Erc20 `0x271f12D1A98f18f9b74d0ce14932454a8a5ded8b`, MimirPoolErc20 `0xf2236633b595BCD4bE49dB0Cc16eb118E059aB0C`, from block 54520313.
- Audit agent `0x385dEBaC2170E1bD840324cb7eF882976319Ed9c` (testnet only).
- Audit e2e: oracle proposed the wrong side on pool 1, the worker (challenge mode) disputed with a 2 USDC bond (`0x49e7fa8a3136daac1db3bce8a4ed24951db5a86ee734c6fd91f64d12a820201d`), the arbiter ruled for side A and the bond returned (`0xb6349347af51f32cc912af383c3ca1a3b810802445eb89ba42992fa9897aa2bf`).
- Smoke: permit stake, VS create/cancel, pool 2 propose/finalize/claim (`0xd7d7de5d4d807e8d13f6d2c2e9ac406c8fd4b01c0b6824c65fe4cc16ff13f5cd`).
