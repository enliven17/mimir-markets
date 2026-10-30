/**
 * Clanker v4 on Base: the launchpad a Base agent deploys its token on, from its own wallet.
 *
 * What we launch (pure; the deploy calldata itself comes from clanker-sdk's v4 converter):
 *   - 100B supply in one Uniswap v4 LP position (Clanker's "Standard" range), paired with WETH, liquidity locked;
 *   - static 1% fee on both sides (Clanker adds its fixed protocol fee on top: 20% of the LP fee, so 1.2% total);
 *   - the agent wallet is token admin and the only reward recipient (100%), fees taken in the paired token (WETH),
 *     so every claim is WETH, unwrapped to ETH in the agent wallet;
 *   - no vault, no airdrop, no dev buy (the agent never holds its own token); Clanker's default sniper fee decay.
 * Fees are collected from the LP into the ClankerFeeLocker on every swap; `claim(feeOwner, token)` (callable by
 * anyone, paying `feeOwner`) moves them out, `token` being the token claimed (WETH here), not the launched one.
 * Docs: https://clanker.gitbook.io/documentation/general/creator-rewards-and-fees.md,
 * https://clanker.gitbook.io/documentation/references/core-contracts/v4/fee-management-contracts/clankerfeelocker.md
 * Addresses: clanker-sdk 4.2.19 CLANKERS.clanker_v4 (checked against the SDK in tests/node/base-clanker.test.ts).
 */
import { parseAbi, type Address } from "viem";

export const CLANKER_FACTORY: Address = "0xE85A59c628F7d27878ACeB4bf3b35733630083a9";
export const CLANKER_FEE_LOCKER: Address = "0xF3622742b1E446D92e45E22923Ef11C2fcD55D68";
export const CLANKER_LP_LOCKER: Address = "0xffA37784D619F228D8B379d287a4D7282e500762";
export const BASE_WETH: Address = "0x4200000000000000000000000000000000000006";

/** The creator's LP fee per side, in bps (Clanker's default static config). */
export const CLANKER_FEE_BPS = 100;
/** Clanker's protocol cut, on top of the creator fee: 20% of the LP fee. */
export const CLANKER_PROTOCOL_SHARE = 0.2;

export const FEE_LOCKER_ABI = parseAbi([
  "function availableFees(address feeOwner, address token) view returns (uint256)",
  "function claim(address feeOwner, address token)",
]);
export const WETH_ABI = parseAbi(["function withdraw(uint256 wad)", "function balanceOf(address) view returns (uint256)"]);

export type ClankerLaunch = { wallet: string; name: string; symbol: string; image: string; description: string; website: string; slug: string };

/** The clanker-sdk v4 token config for an agent's launch (input to `Clanker.getDeployTransaction`). */
export function clankerTokenConfig(a: ClankerLaunch) {
  const wallet = a.wallet as Address;
  return {
    name: a.name,
    symbol: a.symbol,
    image: a.image,
    chainId: 8453 as const,
    tokenAdmin: wallet,
    metadata: { description: a.description, socialMediaUrls: a.website ? [{ platform: "website", url: a.website }] : [] },
    context: { interface: "Mimir", platform: "Mimir", id: a.slug },
    fees: { type: "static" as const, clankerFee: CLANKER_FEE_BPS, pairedFee: CLANKER_FEE_BPS },
    rewards: { recipients: [{ admin: wallet, recipient: wallet, bps: 10_000, token: "Paired" as const }] },
  };
}

/** What a swap of `volumeEth` pays: the creator's LP fee (all to the agent) and Clanker's cut on top. */
export function clankerFeesOn(volumeEth: number) {
  const creator = (volumeEth * CLANKER_FEE_BPS) / 10_000;
  return { creator, protocol: creator * CLANKER_PROTOCOL_SHARE, total: creator * (1 + CLANKER_PROTOCOL_SHARE) };
}

export const clankerTokenUrl = (token: string) => `https://www.clanker.world/clanker/${token}`;
