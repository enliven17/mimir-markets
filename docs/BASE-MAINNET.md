# Base mainnet preparation

The public app remains on Base Sepolia. Arc stays dormant and can be enabled later with `MARKET_CHAINS=base,arc` on both tiers. No Base mainnet market contracts or Safe have been deployed by this preparation.

## Isolation

The Base mainnet backend is **cankat:mimir-markets:base-mainnet**, deployment **groovy-marmot-393** (`https://groovy-marmot-393.convex.cloud`). It has its own internal secrets and Circle LIVE configuration. `MIMIR_BACKEND_OFF=1`, `COUNCIL_BETS=0`, `MIMIR_PAUSE_CREATE_MARKET=1` and `LAUNCH_ARC=0` keep trading automation off.

Existing oracle LLM and admin watchdog settings are copied into the paused environment when available. Preflight requires both. No mainnet alert has been sent and no mainnet worker has been enabled; alert delivery and dispute duty still need operational acceptance before launch.

Keep **hushed-orca-915** for the current Sepolia rollout and archived Arc records. Do not import its snapshot into mainnet. Do not use an unqualified `convex deploy` or `--prod`: those target the project's default production deployment, which is a different environment. Use a deploy key scoped to the exact deployment and explicit `--deployment base-mainnet` for environment/run commands.

`marketDeployments` pins each enabled chain to its chain ID, network, USDC, all three market contracts and first block. Market reads, writes and workers refuse a missing or mismatched binding. Changing `BASE_NETWORK`, contract addresses or the first block cannot reuse an existing index/cursor. There is no reset/rebind function.

After configuring **fresh, verified** mainnet contracts with the
[November 2 security fixes](releases/base-contract-security-2026-11-02.md), bind the empty mainnet backend.
The preflight rejects a VS deployment without the wallet-invitation getter; role checks alone do not establish
that a deployment includes this fix. An independent external contract audit remains required before mainnet.

Bind the backend:

```powershell
npx convex run --deployment base-mainnet marketDeployment:bind '{"chain":"base"}'
npx convex run --deployment base-mainnet marketDeployment:check '{}'
```

Legacy testnet adoption is explicit (`adoptExistingTestnet:true`) and never permits adopting unbound mainnet records. Dormant Arc records stay in their original environment.

To restore Arc mainnet later, configure its existing mainnet contracts and RPC in this **mainnet** backend, enable `base,arc`, and bind `marketDeployment:bind` with `chain:"arc"`. The binding permits another mainnet chain alongside legitimate Base mainnet agents, but refuses testnet bindings. Reindex Arc from its deployment block; do not copy the mixed Sepolia/archive snapshot. Set the matching frontend values and rebuild only after the binding succeeds.

## Roles, wallets and limits

- Base Safe: **0x5b3Cd4D9E2ab1Cc1317bD274aa19ED92D60e12C1**. CREATE2 prediction matches the existing Arc mainnet Safe address; **it still needs deployment on Base**. This is not proof of a deployed Base Safe.
- Same three Safe owners as Arc, threshold **2/3**: `0x9C2e5F2D665D0388Dc3a75Fd8dc7e03e7e1Cc049`, `0x1F28cd3F47A107a215a347D21b7D5F44898aDA17`, `0x36b17F22070adA4e1C22839a4DB416e6640b3351`.
- Safe holds owner, arbiter and treasury roles (explicit owner-sharing flags). Deployer keeps no role; oracle and fee signer remain distinct.
- Oracle: **0x651216ed682cDaa06EfaAc332AaD7a7Bc9f4F7c4**, shared with Arc. It needs **Base ETH**, even though it already has Arc gas.
- Minimum stake **0.1 USDC**, immutable dispute window **86400 seconds**. Suggested launch caps: **500 USDC per market / 50 USDC per account**, in **6-decimal** units. Safe must execute these after deployment.
- Circle LIVE: **20 new BASE council wallets** and a separate BASE house creator wallet have been prepared and verified through the Circle API. They are not Sepolia wallet IDs. Creator: **0x2d006621eff64278c583c8d20e21b9208acfbadd**. No funding was sent. Council bets stay off; creator cannot run until its funding/budget is reviewed.

The reviewed environment and scoped deployment key are in the release worktree's ignored `.temp/base-mainnet.env` and `.temp/base-mainnet-convex-deploy.env`. They contain secrets; never commit or paste them. The live site's current local environment remains Sepolia.

## Commands and verification

```powershell
# Read-only CREATE2 prediction; never signs or sends.
node --env-file=.temp/base-mainnet.env --import tsx scripts/base/create-safe.mts --check-only

# Read-only role/RPC/bytecode checks once the Safe exists.
node --env-file=.temp/base-mainnet.env --import tsx scripts/base/deploy-markets.mts --check-only

# Launch gate: audit, network, isolated backend, Circle LIVE, funding, Safe owners,
# on-chain roles, USDC, dispute window, minimum stake and caps. Prints Safe cap calldata.
node --env-file=.temp/base-mainnet.env --import tsx scripts/base/preflight-mainnet.mts

# Creates or validates Circle BASE wallets; saves incrementally and sends no funds.
node --env-file=.temp/base-mainnet.env --import tsx scripts/base/prepare-wallets.mts --output .temp/base-mainnet.env

# Fork only: canonical Safe + actual Base USDC proxy. No live transactions.
$env:BASE_MAINNET_FORK_RPC='https://mainnet.base.org'
forge test --match-contract BaseMainnetForkTest -vv
```

Mainnet sends additionally require `BASE_CONFIRM_MAINNET=1`. Preflight never sets it or sends transactions. `smoke-markets.mts` remains testnet-only: it must not shorten the mainnet dispute window to accelerate a test.

Fork coverage: one Safe signature rejected, two signatures set caps and pause/unpause; actual USDC approval and EIP-2612 permit; pool resolution/payout; dispute bond and Safe ruling; VS settlement. Fork minting impersonates USDC's master minter **only inside Foundry** and cannot mint live funds.

## Remaining launch gates

1. Fund deployer **0x29C1B32CB675A0B27E87289c7f8E1eFDA2b85108** with Base mainnet ETH; preflight requires at least 0.001 ETH and the deployment still needs a current gas estimate. Its balance at preparation was approximately 0.00003 ETH. Fund the oracle separately with Base ETH.
2. Provide a dedicated production Base RPC. The current public RPC is for checks/forking.
3. Resolve the remaining **2 high** audit entries: legacy Zod 3 and its `@coinbase/cdp-sdk` parent (oversized constrained collection memory exhaustion advisory). Upstream CDP still requires Zod 3; forcing it to Zod 4 would break its one-argument record schemas. This preparation does not hide or accept the finding. Mainnet preflight fails until high/critical counts are zero.
4. Deploy the Safe and fresh Base market contracts, verify source and all roles, execute Safe caps and rehearse pause/unpause. Confirm binding and indexer against the new deployment block.
5. Rebuild Vercel with matching mainnet public settings and the new Convex URL. Validate low-value live transactions, wait the full dispute window, verify payout, monitoring and admin dispute duty, then enable automation deliberately. Keep Arc disabled.

Wallet dependencies were updated within wagmi 2 / ConnectKit compatibility; WalletConnect providers are deduplicated to 2.26.0. Reown's Zod dependency is scoped to 4.6.7 with message-schema compatibility tests. High findings fell from 19 to 2; critical findings remain zero. Moderate findings still require review. Existing contract/unit tests and fork checks are not an independent external security audit.
