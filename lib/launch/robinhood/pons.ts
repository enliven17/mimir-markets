/**
 * Pons V2 on Robinhood Chain (4663): the launchpad a Robinhood agent launches its token on and trades through.
 * Source verified on Sourcify (PonsV2LaunchFactory.sol, PonsV2BondingCurve.sol, PonsV2BondingCurveMath.sol, read
 * 2026-10-19; live config read the same day: launch fee 0.0005 ETH, curve fee 100 bps, phantom quote 1.68 ETH,
 * graduation at 4.2 ETH, 3 s snipe tax, pool fee 0 / tick spacing 200 with the Pons hook):
 *   - factory.launchToken(TokenParams, 0, address(0)) deploys a token and its own bonding curve, priced in ETH;
 *     msg.value must equal the launch fee exactly. The launcher is exempt from the snipe tax.
 *   - curve.buy(quoteIn, minTokensOut, recipient) payable / curve.sell(tokensIn, minQuoteOut, recipient): constant
 *     product on (phantomQuote + real ETH, tokens), fees off the ETH leg. sell pulls with transferFrom.
 *   - Once the curve is sold out it graduates into a Uniswap v4 pool (ETH / token, the Pons hook), traded through the
 *     UniversalRouter (v4.ts). Phase NotGraduated → Swept → PoolCreated.
 *   - The creator's share of fees: the deployer sweeps its curve (sweepFees, allowed while buyback is off), which
 *     credits PonsV2FeeEscrow; claim() pays it out. After graduation the hook credits the escrow directly.
 * Pure here: addresses, ABI, curve math, unit helpers. Chain calls live in executor.ts.
 */
import { parseAbi, type Address } from "viem";

export const PONS_FACTORY: Address = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const PONS_FEE_ESCROW: Address = "0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e";
export const PONS_HOOK: Address = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
export const PONS_DECIMALS = 18;
export const NATIVE: Address = "0x0000000000000000000000000000000000000000";

export const enum Phase {
  NotGraduated = 0,
  Swept = 1,
  PoolCreated = 2,
  Rescued = 3,
}

export const FACTORY_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)",
  "function launchFee() view returns (uint256)",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
]);

export const CURVE_ABI = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function realQuoteReserve() view returns (uint256)",
  /** The deployer may sweep when no internal buyback swap is needed (we launch with buyback off). */
  "function sweepFees(uint256 minBuybackTokensOut)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
]);

export const ESCROW_ABI = parseAbi(["function claim() returns (uint256 amount)", "function balanceOf(address recipient) view returns (uint256)"]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function totalSupply() view returns (uint256)",
]);

/** PonsV2BondingCurveMath._amountOut with no extra fee: x·y = k on (reserveIn, reserveOut). */
export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}

/** Tokens a buy of `ethIn` gets on the curve (the curve's own order: fee and creator tax off the ETH first). */
export function quoteCurveBuy(ethIn: bigint, r: { quote: bigint; tokens: bigint; feeBps: bigint; taxBps: bigint }): bigint {
  const net = ethIn - (ethIn * r.feeBps) / 10_000n - (ethIn * r.taxBps) / 10_000n;
  return amountOut(net, r.quote, r.tokens);
}

/** ETH a sell of `tokensIn` gets on the curve, after fee and creator tax. */
export function quoteCurveSell(tokensIn: bigint, r: { quote: bigint; tokens: bigint; feeBps: bigint; taxBps: bigint }): bigint {
  const gross = amountOut(tokensIn, r.tokens, r.quote);
  return gross - (gross * r.feeBps) / 10_000n - (gross * r.taxBps) / 10_000n;
}

/*
 * Units. The trading engine (lib/launch/engine) counts the native coin in 1e-9 units ("lamports") and prices in coin
 * per whole token. On Robinhood Chain that unit is the gwei: every ETH amount crosses the executor boundary as gwei,
 * so the engine's sizing, P&L and fmtSol all hold unchanged. ponytail: one shared engine; give it a units descriptor
 * if a chain ever needs sub-gwei trade sizes.
 */
export const GWEI = 1_000_000_000n;
export const weiToGwei = (wei: bigint) => wei / GWEI;
export const gweiToWei = (gwei: bigint) => gwei * GWEI;

/** Least acceptable output for `slippageBps` (rounded down, never negative). */
export const minOut = (quoted: bigint, slippageBps: number) => (quoted * BigInt(10_000 - Math.min(10_000, Math.max(0, slippageBps)))) / 10_000n;
