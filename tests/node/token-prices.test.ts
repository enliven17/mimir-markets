import test from "node:test";
import assert from "node:assert/strict";

import { parseDexScreenerPrice, parseJupiterPrice } from "../../lib/server/dex-prices";
import { sumParsedBalances } from "../../lib/server/mainnet";
import { deterministicPriceOption, resolverFromUrl } from "../../lib/resolver-spec";
import { ANSEM_MINT_VERIFIED, dexMintFor, dexSourceUrl } from "../../lib/token-config";

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
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: 0.1402 } }, MINT), 0.1402);
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: 0.1, liquidity: 12 } }, MINT), null);
  assert.equal(parseJupiterPrice({}, MINT), null);
  assert.equal(parseJupiterPrice({ [MINT]: { usdPrice: -1 } }, MINT), null);
});

test("sumParsedBalances adds every token account in raw units", () => {
  const acc = (amount: string, decimals = 6) => ({
    account: { data: { parsed: { info: { tokenAmount: { amount, decimals } } } } },
  });
  assert.equal(sumParsedBalances({ value: [acc("1500000"), acc("500000")] }), 2);
  assert.equal(sumParsedBalances({ value: [] }), 0);
  assert.equal(sumParsedBalances({ value: [acc("abc"), acc("1000000")] }), 1);
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

test("the Mimir ticker is only DEX-priced once its mint is set", () => {
  const prev = process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT;
  const fakeMint = "739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump";
  delete process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT;
  assert.equal(dexMintFor("MIMIR"), null);
  process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT = fakeMint;
  try {
    assert.equal(dexMintFor("MIMIR"), fakeMint);
    const base = {
      creatorPosition: "Yes",
      counterPosition: "No",
      resolutionUrl: "",
      defaultSource: (s: string) => dexSourceUrl(dexMintFor(s)!),
    };
    // Plain "Mimir" prose is not a price claim; the $-ticker is.
    assert.equal(deterministicPriceOption({ ...base, question: "Will the Mimir oracle settle above $5 of volume?" }), null);
    assert.equal(deterministicPriceOption({ ...base, question: "Will $MIMIR close above $0.01 on Friday?" })?.spec.symbol, "MIMIR");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT;
    else process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT = prev;
  }
});
