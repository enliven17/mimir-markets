/**
 * Mimir Launch on Arc through Argus (arguspad.io), Portal #7. Pure and isomorphic: params, the fee-model allocation,
 * the hook-salt miner, call encoding, receipt decoding and the pool price. Chain reads/writes live in the callers.
 *
 * Read from the verified Portal source (Sourcify, chain 5042, src/ArgusV4Portal7.sol) and checked against recent
 * mainnet launches (2026-10-15):
 *   launch(V4HookedLaunchParams7 p, V4TokenMeta meta, bytes32 salt, bytes32 hookSalt), not payable. msg.sender is the
 *   creator (here: the agent owner's own wallet, who signs and pays for the launch). The dev buy is pulled with transferFrom in the quote asset, so a launch with
 *   devBuyQuote = 0 needs no approval and no USDC beyond gas.
 *   Each launch deploys its own splitter, hook, locker and token. The hook must sit at an address whose low 14 bits are
 *   exactly 0x2044 (v4 BEFORE_INITIALIZE | AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA), so `hookSalt` is mined off chain:
 *     splitter = predictSplitter(creator, salt)                (view)
 *     hash     = hookInitCodeHash(splitter, buyTax, sellTax, quote) (view)
 *     find hookSalt: create2(portal, keccak256(abi.encode(creator, hookSalt)), hash) & 0x3fff == 0x2044
 *   Mean 16,384 tries. The two views are asked of the Portal, never rebuilt here (the contract's own advice).
 *   Revenue (the per-side tax plus the pool's 1% LP fee) reaches the splitter; `distribute()` pays Argus's treasury
 *   (treasuryBps = 1000, 10%, read on every recent splitter) and accrues the creator's share; `claim(account)` pays it
 *   out in native USDC. Both are permissionless, so the owner claims from their own wallet. Mimir takes no share:
 *   creatorBps is 10000 (the whole 90% Argus leaves goes to the creator), no burn, no dividend (a dividend bucket needs
 *   a prior ArgusV4LaunchConfig registration or the launch reverts).
 */
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex, type Log } from "viem";

export const ARGUS = {
  portal: "0xB021Be536808f551b31789422Fd28a6c9c6e97Da" as Address,
  portalStartBlock: 20_395_275n,
  usdc: "0x3600000000000000000000000000000000000000" as Address,
  stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b" as Address,
  /** Argus's cut of every revenue leg, in bps of the leg (splitter.treasuryBps). */
  treasuryBps: 1000,
  hookMask: 0x3fff,
  hookRequired: 0x2044,
  maxTaxBps: 1000,
  /** What recent launches use (and the Argus site's defaults): 1B tokens at 18 dp, open at $2,500 FDV, bond at $45,000. */
  totalSupply: 1_000_000_000n * 10n ** 18n,
  startFdvUsdc6: 2_500n * 10n ** 6n,
  bondFdvUsdc6: 45_000n * 10n ** 6n,
  /** Measured on mainnet 2026-10-15: a launch with no dev buy uses ~2.98M gas (about 0.06 USDC at 20 gwei). */
  launchGas: 3_000_000n,
} as const;

export const ARGUS_ABI = parseAbi([
  "struct V4HookedLaunchParams7 { string name; string symbol; uint256 totalSupply; uint256 startFdvUsdc6; uint256 bondFdvUsdc6; uint16 buyTaxBps; uint16 sellTaxBps; uint16 creatorBps; uint16 burnBps; uint16 dividendBps; uint16 liquidityBps; uint256 devBuyQuote; address quoteAsset; uint8 expectConvert; }",
  "struct V4TokenMeta { string imageURI; string website; string twitter; string telegram; string description; }",
  "function launch(V4HookedLaunchParams7 p, V4TokenMeta meta, bytes32 salt, bytes32 hookSalt) returns (address token)",
  "function predictSplitter(address creator, bytes32 salt) view returns (address)",
  "function hookInitCodeHash(address splitter_, uint16 buyTaxBps, uint16 sellTaxBps, address quote) view returns (bytes32)",
  "function predictHook(address creator, bytes32 salt, bytes32 hookSalt, uint16 buyTaxBps, uint16 sellTaxBps, address quote) view returns (address hook, uint160 mask, bool valid)",
  "function predictToken(address creator, bytes32 salt, address hook, address quote) view returns (address token)",
  "function poolIdFor(address token, address hook, address quote) pure returns (bytes32)",
  "event TokenCreated(address indexed token, address indexed creator, string name, string symbol, bytes32 poolId, string imageURI, string website, string twitter, string telegram)",
  "event PartsDeployed(address indexed token, address locker, address hook, address splitter)",
]);

export const ARGUS_SPLITTER_ABI = parseAbi([
  "function distribute() returns (uint256 quoteUsdc6, uint256 tokenAmount18)",
  "function claim(address account) returns (uint256 amountUsdc6, uint256 amount18)",
  "function claimableQuote6(address) view returns (uint256)",
  "function claimableToken18(address) view returns (uint256)",
  "function treasuryBps() view returns (uint16)",
]);
export const ARGUS_LOCKER_ABI = parseAbi(["function collect() returns (uint256 amount0, uint256 amount1)"]);
export const STATE_VIEW_ABI = parseAbi(["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);

// ───────────────────────────── the fee model

/** Everything the splitter leaves after Argus's 10% goes to the creator (the owner): no burn, no dividend, no Mimir cut. */
export const ARGUS_ALLOCATION = { creatorBps: 10000, burnBps: 0, dividendBps: 0, liquidityBps: 0 } as const;

// ───────────────────────────── params

export interface ArgusLaunchInput {
  name: string;
  symbol: string;
  description: string;
  imageURI: string;
  buyTaxBps: number;
  sellTaxBps: number;
  devBuyUsdc6?: bigint;
  website?: string;
  twitter?: string;
  telegram?: string;
}

export function launchParams(i: ArgusLaunchInput) {
  const name = i.name.trim(), symbol = i.symbol.trim().toUpperCase();
  if (name.length < 2 || name.length > 32) throw new Error("name must be 2 to 32 characters");
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error("ticker must be 2 to 10 letters or digits");
  for (const t of [i.buyTaxBps, i.sellTaxBps]) if (!Number.isInteger(t) || t < 0 || t > ARGUS.maxTaxBps) throw new Error("each tax is 0 to 10%");
  if (i.buyTaxBps === 0 && i.sellTaxBps === 0) throw new Error("at least one of the buy and sell taxes must be above 0");
  if (!/^(ipfs:\/\/|https:\/\/)\S+$/.test(i.imageURI)) throw new Error("image must be an ipfs:// or https:// URI");
  const a = ARGUS_ALLOCATION;
  return {
    p: {
      name, symbol, totalSupply: ARGUS.totalSupply, startFdvUsdc6: ARGUS.startFdvUsdc6, bondFdvUsdc6: ARGUS.bondFdvUsdc6,
      buyTaxBps: i.buyTaxBps, sellTaxBps: i.sellTaxBps, ...a, devBuyQuote: i.devBuyUsdc6 ?? 0n, quoteAsset: ARGUS.usdc,
      // 1 = must pay in the quote (USDC), what the Argus site sends: a payout-asset flip mid-launch reverts instead.
      expectConvert: 1,
    },
    meta: { imageURI: i.imageURI, website: i.website ?? "", twitter: i.twitter ?? "", telegram: i.telegram ?? "", description: i.description.slice(0, 280) },
  };
}
export type ArgusParams = ReturnType<typeof launchParams>;

/** A stable token salt per agent (its uid): a retried launch from the same wallet hits the same addresses, never a second token. */
export const tokenSalt = (agentUid: string): Hex => keccak256(new TextEncoder().encode(`mimir-launch:argus:${agentUid}`));

// ───────────────────────────── the hook miner

/** The CREATE2 address the Portal will use for `hookSalt`. */
export function hookAddressFor(creator: Address, hookSalt: Hex, initCodeHash: Hex, portal: Address = ARGUS.portal): Address {
  const create2Salt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [creator, hookSalt]));
  const digest = keccak256(`0xff${portal.slice(2)}${create2Salt.slice(2)}${initCodeHash.slice(2)}` as Hex);
  return getAddress(`0x${digest.slice(-40)}`);
}

/**
 * Deterministic search for a hookSalt whose hook address carries exactly the 0x2044 flag bits. Starts from a seed so two
 * agents never mine the same salt; `maxTries` bounds it (the expected count is 16,384).
 */
export function mineHookSalt(creator: Address, initCodeHash: Hex, seed: Hex, maxTries = 400_000): { hookSalt: Hex; hook: Address; tries: number } {
  for (let i = 0; i < maxTries; i++) {
    const hookSalt = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [seed, BigInt(i)]));
    const hook = hookAddressFor(creator, hookSalt, initCodeHash);
    if ((Number(BigInt(hook) & 0x3fffn)) === ARGUS.hookRequired) return { hookSalt, hook, tries: i + 1 };
  }
  throw new Error(`no hook salt found in ${maxTries} tries`);
}

// ───────────────────────────── encoding and decoding

export function encodeLaunch(params: ArgusParams, salt: Hex, hookSalt: Hex): Hex {
  return encodeFunctionData({ abi: ARGUS_ABI, functionName: "launch", args: [params.p, params.meta, salt, hookSalt] });
}

export interface ArgusLaunched {
  token: Address;
  creator: Address;
  symbol: string;
  poolId: Hex;
  hook: Address;
  locker: Address;
  splitter: Address;
}

/** The launch's addresses from its receipt logs (TokenCreated + PartsDeployed from the Portal). */
export function decodeLaunch(logs: readonly Pick<Log, "address" | "data" | "topics">[]): ArgusLaunched | null {
  let created: { token: Address; creator: Address; symbol: string; poolId: Hex } | null = null;
  let parts: { locker: Address; hook: Address; splitter: Address } | null = null;
  for (const l of logs) {
    if (l.address.toLowerCase() !== ARGUS.portal.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: ARGUS_ABI, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "TokenCreated") created = { token: ev.args.token, creator: ev.args.creator, symbol: ev.args.symbol, poolId: ev.args.poolId };
      if (ev.eventName === "PartsDeployed") parts = { locker: ev.args.locker, hook: ev.args.hook, splitter: ev.args.splitter };
    } catch {
      // not one of ours
    }
  }
  return created && parts ? { ...created, ...parts } : null;
}

// ───────────────────────────── price

/**
 * USDC per token from the pool's sqrtPriceX96 (token 18 dp, USDC 6 dp). The token is currency0 when its address sorts
 * below USDC's (0x3600…), which is almost never: then the raw price is quote per token; otherwise it is inverted.
 */
export function priceUsdc(sqrtPriceX96: bigint, token: Address): number {
  if (sqrtPriceX96 === 0n) return 0;
  const tokenIs0 = BigInt(token) < BigInt(ARGUS.usdc);
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const raw = ratio * ratio; // currency1 per currency0, in raw units
  const usdcPerTokenRaw = tokenIs0 ? raw : 1 / raw;
  return usdcPerTokenRaw * 10 ** (18 - 6);
}

export const dexChartArc = (poolId: string) => `https://dexscreener.com/arc/${poolId}?embed=1&theme=dark&trades=0&info=0`;
