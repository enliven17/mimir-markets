import assert from "node:assert/strict";
import test from "node:test";

import {
  formatUsdc,
  formatUsdcBare,
  formatUsdcUnits,
  formatUsdcUnitsBare,
  unitsToUsdc,
} from "../../lib/money";

test("formatUsdc renders dust, sub-dollar and dollar amounts distinctly", () => {
  assert.equal(formatUsdc(0), "0 USDC");
  assert.equal(formatUsdc(Number.NaN), "0 USDC");
  assert.equal(formatUsdc(0.0000001), "<0.000001 USDC");
  assert.equal(formatUsdc(0.5), "0.5 USDC");
  assert.equal(formatUsdc(0.123456), "0.123456 USDC");
  assert.equal(formatUsdc(1234.5), "1,234.50 USDC");
});

test("formatUsdcBare drops trailing zeros and the unit", () => {
  assert.equal(formatUsdcBare(12), "12");
  assert.equal(formatUsdcBare(1234.567), "1,234.57");
  assert.equal(formatUsdcBare(Number.NaN), "0");
});

test("base units convert at 6 decimals from bigint, string or number", () => {
  assert.equal(unitsToUsdc(2_500_000n), 2.5);
  assert.equal(unitsToUsdc("2500000"), 2.5);
  assert.equal(unitsToUsdc(1), 0.000001);
  assert.equal(unitsToUsdc(undefined), 0);
  assert.equal(unitsToUsdc("not a number"), 0);
  assert.equal(formatUsdcUnitsBare("1234567890"), "1,234.57");
  assert.equal(formatUsdcUnits(3_000_000n), "3.00 USDC");
});
