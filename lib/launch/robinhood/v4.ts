/**
 * Uniswap v4 on Robinhood Chain, where a Pons token trades once it graduates: the ETH/token pool with fee 0, tick
 * spacing 200 and the Pons hook (which takes its own fee after each swap, so always quote through the V4Quoter,
 * which runs the hook). Official deployments (developers.uniswap.org/deployments.json, code checked on chain
 * 2026-10-19). A swap is one UniversalRouter V4_SWAP command: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
 * (v4-periphery Actions.sol). Selling a token goes through Permit2: the token approves Permit2 once, then Permit2
 * approves the router.
 */
import { encodeAbiParameters, encodePacked, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";

import { NATIVE, PONS_HOOK } from "./pons";

export const UNIVERSAL_ROUTER: Address = "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99";
export const V4_QUOTER: Address = "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94";
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const V4_SWAP = "0x10";
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

/** The graduated pool: native ETH (address 0) always sorts first. */
export const ponsPool = (token: Address, fee: number, tickSpacing: number): PoolKey => ({ currency0: NATIVE, currency1: token, fee, tickSpacing, hooks: PONS_HOOK });

export const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
export const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);
export const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

const SWAP_PARAMS = parseAbiParameters(
  "((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)",
);

/** UniversalRouter.execute arguments for one exact-in swap on `pool`: ETH → token when `buy`, token → ETH otherwise. */
export function v4SwapCall(pool: PoolKey, buy: boolean, amountIn: bigint, minAmountOut: bigint, deadline: bigint): readonly [Hex, Hex[], bigint] {
  const [currencyIn, currencyOut] = buy ? [pool.currency0, pool.currency1] : [pool.currency1, pool.currency0];
  const actions = encodePacked(["uint8", "uint8", "uint8"], [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);
  const params = [
    encodeAbiParameters(SWAP_PARAMS, [{ poolKey: pool, zeroForOne: buy, amountIn, amountOutMinimum: minAmountOut, hookData: "0x" }]),
    encodeAbiParameters(parseAbiParameters("address, uint256"), [currencyIn, amountIn]),
    encodeAbiParameters(parseAbiParameters("address, uint256"), [currencyOut, minAmountOut]),
  ];
  const input = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [actions, params]);
  return [V4_SWAP, [input], deadline] as const;
}
