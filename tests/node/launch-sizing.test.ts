import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyCapHit, dailyLossCap, entrySize, MIN_TRADE_LAMPORTS, minSpendableToTrade } from "../../lib/launch/engine/sizing";
import type { SizeInput } from "../../lib/launch/engine/sizing";
import { fillPrice, fmtSol, pctToBps } from "../../lib/launch/engine/sol";
import { MINT_A, MINT_B, MINT_C, risk } from "../../lib/launch/engine/fixtures";

const SOL = 1_000_000_000n;
const base = (over: Partial<SizeInput> = {}): SizeInput => ({
  spendable: 10n * SOL,
  bankrollLamports: 10n * SOL,
  risk: risk(),
  dailyPnl: 0n,
  openPositions: [],
  ...over,
});

test("sizes positionPct of the bankroll", () => {
  assert.equal(entrySize(base()).lamports, SOL); // 10% of 10 SOL
});

test("never exceeds spendable", () => {
  assert.equal(entrySize(base({ spendable: SOL / 2n })).lamports, SOL / 2n);
});

test("zero or negative spendable → 0", () => {
  for (const spendable of [0n, -5n]) {
    const r = entrySize(base({ spendable }));
    assert.equal(r.lamports, 0n);
    assert.equal(r.pause, false);
  }
});

test("below minimum trade size → 0", () => {
  const r = entrySize(base({ spendable: MIN_TRADE_LAMPORTS - 1n }));
  assert.equal(r.lamports, 0n);
  assert.match(r.reason, /below minimum/);
});

test("daily cap exactly hit → 0 and pause", () => {
  // 20% of 10 SOL = 2 SOL
  const r = entrySize(base({ dailyPnl: -2n * SOL }));
  assert.equal(r.lamports, 0n);
  assert.equal(r.pause, true);
  assert.equal(dailyCapHit(-2n * SOL + 1n, 10n * SOL, 20), false);
  assert.equal(dailyCapHit(-3n * SOL, 10n * SOL, 20), true);
});

test("cap disabled (0%) or NaN never pauses", () => {
  assert.equal(entrySize(base({ risk: risk({ maxDailyLossPct: 0 }), dailyPnl: -9n * SOL })).pause, false);
  assert.equal(dailyLossCap(10n * SOL, NaN), 0n);
});

test("max open positions and no double entry", () => {
  const three = [{ mint: MINT_A }, { mint: MINT_B }, { mint: MINT_C }];
  assert.match(entrySize(base({ openPositions: three })).reason, /max 3/);
  assert.equal(entrySize(base({ openPositions: three.slice(0, 1), maxOpen: 1 })).lamports, 0n);
  const dup = entrySize(base({ openPositions: [{ mint: MINT_A }], mint: MINT_A }));
  assert.equal(dup.lamports, 0n);
  assert.match(dup.reason, /already holding/);
});

test("NaN or zero positionPct → 0; >100% clamps to the bankroll", () => {
  assert.equal(entrySize(base({ risk: risk({ positionPct: NaN }) })).lamports, 0n);
  assert.equal(entrySize(base({ risk: risk({ positionPct: 0 }) })).lamports, 0n);
  assert.equal(entrySize(base({ risk: risk({ positionPct: 500 }) })).lamports, 10n * SOL);
});

test("sol helpers", () => {
  assert.equal(pctToBps(12.5), 1250n);
  assert.equal(fmtSol(830_000_000n), "0.83");
  assert.equal(fmtSol(-1_500_000_000n), "-1.5");
  assert.equal(fmtSol(2n * SOL), "2");
  assert.equal(fillPrice(SOL, 1_000_000n, 6), 1);
  assert.equal(fillPrice(0n, 1n, 6), null);
});

test("minSpendableToTrade is the exact balance at which a flat agent's entrySize first trades", () => {
  const flat = (spendable: bigint, positionPct: number, dailyPnl: bigint) =>
    entrySize({ spendable, bankrollLamports: spendable - dailyPnl, risk: risk({ positionPct, maxDailyLossPct: 0 }), dailyPnl, openPositions: [] }).lamports;
  for (const positionPct of [100, 25, 10, 3.33, 0.5]) {
    for (const dailyPnl of [0n, SOL / 50n, -SOL / 50n, SOL, -5n * SOL]) {
      const need = minSpendableToTrade(risk({ positionPct }), dailyPnl);
      assert.ok(need !== null);
      assert.ok(flat(need, positionPct, dailyPnl) >= MIN_TRADE_LAMPORTS, `trades at ${need} (${positionPct}%, pnl ${dailyPnl})`);
      for (const below of [need - 1n, need / 2n, 1n]) {
        if (below > 0n && below < need) assert.equal(flat(below, positionPct, dailyPnl), 0n, `idle at ${below} (${positionPct}%, pnl ${dailyPnl})`);
      }
    }
  }
  assert.equal(minSpendableToTrade(risk({ positionPct: 10 }), 0n), SOL / 10n); // 10% of 0.1 SOL = 0.01 SOL
  assert.equal(minSpendableToTrade(risk({ positionPct: 0.001 }), 0n), null);
});
