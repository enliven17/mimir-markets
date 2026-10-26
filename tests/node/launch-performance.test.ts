import assert from "node:assert/strict";
import { test } from "node:test";
import { tradingPerformance } from "../../lib/launch/performance";
test("public evidence excludes unconfirmed/future fills and uses sold cost for partial exits", () => {
  const now = 100 * 86_400_000;
  const t = (pnl: string, at: number, status = "confirmed") => ({ side: "sell", status, lamports: "100", pnlLamports: pnl, sig: String(at), at });
  const r = tradingPerformance([t("20", now - 2), t("-30", now - 1), t("999", now, "pending"), t("999", now + 1), t("50", now - 20 * 86_400_000)], [{ mint: "a", symbol: "A", costLamports: "40" }], now);
  assert.equal(r.periods[0].pnl, "-10"); assert.equal(r.periods[0].closedCost, "210");
  assert.equal(r.periods[0].realizedDrawdown, "30"); assert.equal(r.periods[1].pnl, "40");
  assert.equal(r.openCost, "40"); assert.equal(r.evidence.length, 3);
  assert.equal(tradingPerformance([], [], now).periods[0].costReturnPct, null);
});
