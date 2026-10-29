/**
 * Mimir's fees on Arc (docs/ARC.md). Every on-chain entry (opening a market, a
 * stake, an agent's stake) pays an entry fee taken from the stake. Copy stakes
 * add 1% of the profit to the basket creator and 1% to Mimir, on wins only.
 * Deploying an agent costs a flat USDC price. Pure and isomorphic.
 */

/** The standard entry fee in basis points (MimirFees' default rate). */
export const ENTRY_FEE_BPS = 50;
/** Agent deploy price in USDC. */
export const AGENT_DEPLOY_USD = 1;
/** Copy stakes: share of the profit to the basket creator, and to Mimir. */
export const REFERRER_FEE_BPS = 100;
export const COPY_FEE_BPS = 100;
