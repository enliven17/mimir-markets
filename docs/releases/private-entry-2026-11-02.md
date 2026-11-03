# Restricted private VS participation

Private means only wallets approved by the claim creator may challenge. Both native Arc and Base VS use per-claim wallet grants. Pools remain public. Questions, transactions and approval records remain public on chain.

1. Select **Private · approved wallets only** when creating a VS claim. Public remains the default. Creation funds one claim and leaves all challengers unauthorized.
2. On that claim's page, the creator enters participant wallet addresses in **Manage approved wallets**, then confirms **Approve wallets**. One transaction changes up to 100 wallets. **Check wallets** reads current status for the addresses entered; it does not enumerate every past approval.
3. Share the claim link with friends. Only an approved connected wallet can join. For a smart wallet, approve the account address that actually calls the market, not its owner's signer address.
4. The creator may revoke future entry while the claim is open/active. Existing funded positions retain their payout and dispute rights. Each rematch starts with no approved wallets.

Grant failures can be retried on the same claim page. They never rerun creation. If a confirmed creation's receipt/details cannot be read, the app keeps creation disabled and links its transaction so the existing claim can be found safely.

The app probes wallet-permission support before private creation, checks the connected wallet's live permission, and rechecks before sending a challenge. Failed reads block private actions. The contract is the final authority and rejects unapproved callers before fees or liquidity/slot accounting. Public staking does not depend on invitation reads.

Legacy `inviteKey` arguments/selectors remain for ABI compatibility but confer no permission. `inviteKeyHash` is zero. Base already used this policy at the starting revision; the native contract now matches it.

This source update requires compatible deployments/configuration before use. It does not upgrade a deployed contract in place, and no deployment was performed. Do not fall back to old shared-key contracts if the `invited` view is unavailable. Sports and automatic/JSON settlement behavior are unchanged by this update.

Browser component checks: `node tests/ui/private-claims.mjs` uses the installed Playwright Chromium and real React components with fixture chain/wallet/Convex boundaries. Set `PRIVATE_UI_BROWSER` to an existing Chromium executable if necessary. This does not replace a full production-app browser run.
