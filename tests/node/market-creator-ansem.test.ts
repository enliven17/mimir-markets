import test from "node:test";
import assert from "node:assert/strict";

import { agreedSpot, ansemDraft, ansemThreshold, draftAnsemClaims, formatTokenPrice } from "../../agents/market-creator/ansem";
import { draftProblem, scoreDraft } from "../../agents/market-creator/draft";
import { resolverFromUrl } from "../../lib/resolver-spec";
import { ANSEM_MINT_VERIFIED } from "../../lib/token-config";
import type { PriceReading } from "../../lib/price-consensus";

const NOW = Date.parse("2026-09-29T15:00:00.000Z");
const NOW_SEC = Math.floor(NOW / 1000);
const reading = (source: PriceReading["source"], priceUsd: number): PriceReading => ({ source, priceUsd, at: NOW });

test("agreedSpot needs two readings inside the consensus spread", () => {
  assert.equal(agreedSpot([]), null);
  assert.equal(agreedSpot([reading("dexscreener", 0.01)]), null);
  assert.equal(agreedSpot([reading("dexscreener", 0.01), reading("jupiter", 0.0125)]), null);
  const mid = agreedSpot([reading("dexscreener", 0.01), reading("jupiter", 0.0101)]);
  assert.ok(mid && Math.abs(mid - 0.01005) < 1e-9);
});

test("sub-dollar prices keep four significant digits", () => {
  assert.equal(formatTokenPrice(0.0123456), "0.01235");
  assert.equal(formatTokenPrice(1234.567), "1,234.57");
  assert.equal(ansemThreshold(0.01, "above", 0.02), 0.0102);
  assert.equal(ansemThreshold(0.01, "below", 0.02), 0.0098);
});

test("an ANSEM draft carries a deterministic price resolver on the DexScreener url", () => {
  const d = ansemDraft(0.0102, "above", NOW + 30 * 60_000, ANSEM_MINT_VERIFIED);
  assert.equal(d.source, "ansem");
  assert.equal(d.category, "crypto");
  assert.ok(d.resolutionUrl.startsWith(`https://api.dexscreener.com/tokens/v1/solana/${ANSEM_MINT_VERIFIED}#mimir=`));
  assert.deepEqual(resolverFromUrl(d.resolutionUrl), { kind: "price", symbol: "ANSEM", op: ">", threshold: 0.0102 });
  assert.equal(draftProblem(d, NOW_SEC), null);
  assert.ok(scoreDraft(d, NOW_SEC).score >= 60, `quality ${scoreDraft(d, NOW_SEC).score}`);

  const below = ansemDraft(0.0098, "below", NOW + 30 * 60_000, ANSEM_MINT_VERIFIED);
  assert.deepEqual(resolverFromUrl(below.resolutionUrl), { kind: "price", symbol: "ANSEM", op: "<", threshold: 0.0098 });
});

test("draftAnsemClaims drafts from agreeing readings and skips when they disagree", async () => {
  const agree = async () => [reading("dexscreener", 0.01), reading("jupiter", 0.01)];
  const drafts = await draftAnsemClaims(1, 30, NOW, agree);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]!.deadline, NOW_SEC + 30 * 60);

  const disagree = async () => [reading("dexscreener", 0.01), reading("jupiter", 0.02)];
  assert.deepEqual(await draftAnsemClaims(1, 30, NOW, disagree), []);
  const failing = async (): Promise<PriceReading[]> => { throw new Error("down"); };
  assert.deepEqual(await draftAnsemClaims(1, 30, NOW, failing), []);
  assert.deepEqual(await draftAnsemClaims(0, 30, NOW, agree), []);
});
