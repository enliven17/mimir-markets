import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COPY_RISK as p, copyRiskProblem, copyQuoteProblem } from "../../lib/launch/copy-risk";
test("copy cost limits include other agents and outstanding reservations", () => {
  const s = { tokenCost: 190_000_000n, totalCost: 900_000_000n, dailyPnl: 0n, pnl: 0n, peak: 0n };
  assert.match(copyRiskProblem(p, s, 20_000_000n)!, /token/);
  assert.match(copyRiskProblem(p, { ...s, tokenCost: 0n }, 110_000_000n)!, /open cost/);
  assert.match(copyRiskProblem(p, { ...s, tokenCost: 0n, dailyPnl: -100_000_000n }, 10n)!, /Daily/);
  assert.match(copyRiskProblem(p, { ...s, tokenCost: 0n, pnl: -100_000_000n, peak: 100_000_000n }, 10n)!, /drawdown/);
});
test("copy quote guard rejects stale signals, unknown liquidity and adverse or favorable drift", () => {
  const q = { referencePrice: 1, signalAt: 1000, price: 1, liquiditySol: 1000, now: 2000 };
  assert.equal(copyQuoteProblem(p, q, 10_000_000n), null);
  assert.match(copyQuoteProblem(p, { ...q, price: 1.1 }, 10n)!, /Price/);
  assert.match(copyQuoteProblem(p, { ...q, price: .9 }, 10n)!, /Price/);
  assert.match(copyQuoteProblem(p, { ...q, now: 122000 }, 10n)!, /expired/);
  assert.match(copyQuoteProblem(p, { ...q, liquiditySol: NaN }, 10n)!, /liquidity/);
  assert.match(copyQuoteProblem(p, q, 2_000_000_000n)!, /share-of-liquidity/);
});
