/**
 * Clanker v4 on Base: where an agent's owner may launch the agent's token, from their own wallet.
 *
 * What we build (pure; the deploy calldata itself comes from clanker-sdk's v4 converter):
 *   - 100B supply in one Uniswap v4 LP position (Clanker's "Standard" range), paired with WETH, liquidity locked;
 *   - static 1% fee on both sides (Clanker adds its fixed protocol fee on top: 20% of the LP fee, so 1.2% total);
 *   - the owner's wallet is token admin and the only reward recipient (100%), fees taken in the paired token (WETH).
 *     Mimir takes no share;
 *   - no vault, no airdrop, no dev buy; Clanker's default sniper fee decay.
 * Fees are collected from the LP into the ClankerFeeLocker on every swap; `claim(feeOwner, token)` (callable by
 * anyone, paying `feeOwner`) moves them out, `token` being the token claimed (WETH here), not the launched one.
 * Docs: https://clanker.gitbook.io/documentation/general/creator-rewards-and-fees.md,
 * https://clanker.gitbook.io/documentation/references/core-contracts/v4/fee-management-contracts/clankerfeelocker.md
 * Addresses: clanker-sdk 4.2.19 CLANKERS.clanker_v4 (checked against the SDK in tests/node/base-clanker.test.ts).
 */
import { decodeEventLog, parseAbi, type Address, type Hex, type Log } from "viem";

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
/** The factory's TokenCreated event (clanker-sdk Clanker_v4_abi). */
export const CLANKER_EVENTS_ABI = parseAbi([
  "event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address mevModule, uint256 extensionsSupply, address[] extensions)",
]);

/** `owner` is the agent owner's wallet: it sends the deploy, is the token admin and gets every fee. */
export type ClankerLaunch = { owner: string; name: string; symbol: string; image: string; description: string; website: string; slug: string };

/** The clanker-sdk v4 token config for an agent's token (input to `Clanker.getDeployTransaction`). */
export function clankerTokenConfig(a: ClankerLaunch) {
  const wallet = a.owner as Address;
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

/** What a swap of `volumeEth` pays: the creator's LP fee (all to the owner) and Clanker's cut on top. */
export function clankerFeesOn(volumeEth: number) {
  const creator = (volumeEth * CLANKER_FEE_BPS) / 10_000;
  return { creator, protocol: creator * CLANKER_PROTOCOL_SHARE, total: creator * (1 + CLANKER_PROTOCOL_SHARE) };
}


export interface ClankerCreated {
  token: Address;
  admin: Address;
  sender: Address;
  symbol: string;
  context: string;
}

/** The token the factory created in a receipt's logs (only events from the Clanker v4 factory count). */
export function decodeClankerLaunch(logs: readonly Pick<Log, "address" | "data" | "topics">[], factory: Address = CLANKER_FACTORY): ClankerCreated | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: CLANKER_EVENTS_ABI, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "TokenCreated") return { token: ev.args.tokenAddress, admin: ev.args.tokenAdmin, sender: ev.args.msgSender, symbol: ev.args.tokenSymbol, context: ev.args.tokenContext };
    } catch {
      // another event of the factory
    }
  }
  return null;
}
