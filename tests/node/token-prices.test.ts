import test from "node:test";
import assert from "node:assert/strict";

import { parseDexScreenerPrice, parseJupiterPrice } from "../../lib/server/dex-prices";
import { deterministicPriceOption, resolverFromUrl } from "../../lib/resolver-spec";
import { ANSEM_MINT_VERIFIED, dexMintFor, dexSourceUrl } from "../../lib/dex-tokens";

const MINT = ANSEM_MINT_VERIFIED;
const SOL = "So11111111111111111111111111111111111111112";

test("DexScreener: deepest solana pair where the mint is the base token", () => {
  const body = [
    { chainId: "solana", baseToken: { address: MINT }, priceUsd: "0.14", liquidity: { usd: 2_400_000 } },
    { chainId: "solana", baseToken: { address: MINT }, priceUsd: "0.50", liquidity: { usd: 5_000 } },
    { chainId: "solana", baseToken: { address: SOL }, priceUsd: "150", liquidity: { usd: 9e9 } },
    { chainId: "base", baseToken: { address: MINT }, priceUsd: "9", liquidity: { usd: 9e9 } },
    { chainId: "solana", baseToken: { address: MINT }, priceUsd: "99", liquidity: { usd: 10 } },
  ];
  assert.equal(parseDexScreenerPrice(body, MINT), 0.14);
  assert.equal(parseDexScreenerPrice({ pairs: body }, MINT), 0.14);
  assert.equal(parseDexScreenerPrice([], MINT), null);
  assert.equal(parseDexScreenerPrice(null, MINT), null);
  assert.equal(
    parseDexScreenerPrice([{ chainId: "solana", baseToken: { address: MINT }, priceUsd: "x", liquidity: { usd: 1e6 } }], MINT),
    null,
  );
});

test("Jupiter price v3 by mint, skipping thin liquidity", () => {
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: 0.1402, liquidity: 1_857_950 } }, MINT), 0.1402);
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: 0.1402 } }, MINT), null, "no liquidity figure, no price");
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: 0.1, liquidity: 50_000 } }, MINT), null, "below the 250k floor");
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: 0.1, liquidity: 12 } }, MINT), null);
  assert.equal(parseJupiterPrice({}, MINT), null);
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: -1 } }, MINT), null);
});

test("$ANSEM is DEX-priced and gets a deterministic resolver on the create form", () => {
  assert.equal(dexMintFor("ansem"), MINT);
  const opt = deterministicPriceOption({
    question: "Will $ANSEM trade above $0.25 by October 31?",
    creatorPosition: "Yes",
    counterPosition: "No",
    resolutionUrl: "",
    defaultSource: (s) => dexSourceUrl(dexMintFor(s)!),
  });
  assert.ok(opt);
  assert.equal(opt.spec.symbol, "ANSEM");
  assert.equal(opt.spec.op, ">");
  assert.equal(opt.spec.threshold, 0.25);
  assert.ok(opt.resolutionUrl.length <= 200);
  assert.deepEqual(resolverFromUrl(opt.resolutionUrl), opt.spec);
});

test("the DEX liquidity floor defaults far above dust pools", async () => {
  const { MIN_LIQUIDITY_USD, parseDexScreenerPrice } = await import("../../lib/server/dex-prices");
  assert.equal(MIN_LIQUIDITY_USD, 250_000);
  const thin = [{ chainId: "solana", baseToken: { address: MINT }, priceUsd: "0.2", liquidity: { usd: 200_000 } }];
  assert.equal(parseDexScreenerPrice(thin, MINT), null);
});
