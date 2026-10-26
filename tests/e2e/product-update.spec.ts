import { test, expect, type Page } from "@playwright/test";
import { seriesDraft } from "../../lib/market-series";
const now = Math.floor(Date.now() / 1000);
const draft = seriesDraft("sol-daily", 150, Date.now())!;
const market = { ...draft, kind: "pool", marketId: 42, status: "open", creator: "0x" + "a".repeat(40), createdAt: now - 3600,
  stakeA: "1000000000000000000", stakeB: "2000000000000000000", volumeUsd: 3, participants: 2, winner: 0, summary: "", isPrivate: false,
  disputableUntil: 0, refundAt: draft.deadline + 604800, updatedBlock: 1, feesCollected: "0", positions: [], events: [], verdict: null };
async function mockConvex(page: Page) {
  await page.routeWebSocket(/\.convex\.cloud\/.*\/sync/, (ws) => {
    let version = { querySet: 0, identity: 0, ts: "AAAAAAAAAAA=" }, timestamp = 0;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)); if (msg.type !== "ModifyQuerySet") return;
      const modifications = msg.modifications.map((q: any) => {
        if (q.type === "Remove") return { type: "QueryRemoved", queryId: q.queryId };
        let value: any = [];
        if (q.udfPath === "arc:markets") value = [market];
        if (q.udfPath === "arc:market") value = market;
        if (q.udfPath === "arcCouncilDb:takeFor") value = null;
        if (q.udfPath === "councilOpinions:forMarket") value = [];
        if (q.udfPath === "launchFeeDb:feesView") value = null;
        if (q.udfPath === "discovery:radar") value = [{ ...market, a: 2, b: 1, unknown: 1, disagreement: 2 / 3, updatedAt: Date.now() }];
        if (q.udfPath === "launch:card") value = { slug: "orbit", owner: "owner", name: "Orbit", ticker: "ORBIT", avatarSeed: "orbit", thesis: "Observe first.", status: "paused", trading: { enabled: true }, markets: { enabled: false }, wallet: null, arc: null, mint: null, token: null, chain: "solana" };
        if (q.udfPath === "launch:performance") value = { status: "paused", createdAt: Date.now() - 86400000, unit: "SOL", decimals: 9, truncated: false,
          strategy: { revision: 1, at: Date.now(), fingerprint: "a".repeat(64) }, positions: [{ mint: "token", symbol: "TOKEN", costLamports: "100000000" }],
          trades: [{ side: "sell", status: "confirmed", lamports: "120000000", pnlLamports: "20000000", at: Date.now() - 1000, sig: "confirmed" }, { side: "sell", status: "pending", lamports: "999000000", pnlLamports: "999000000", at: Date.now(), sig: "pending" }] };
        return { type: "QueryUpdated", queryId: q.queryId, value, logLines: [], journal: null };
      });
      const ts = Buffer.alloc(8); ts.writeBigUInt64LE(BigInt(++timestamp));
      const end = { querySet: msg.newVersion, identity: 0, ts: ts.toString("base64") };
      ws.send(JSON.stringify({ type: "Transition", startVersion: version, endVersion: end, modifications })); version = end;
    });
  });
}
async function clean(page: Page) {
  const consent = page.getByRole("button", { name: "I understand and accept", exact: true });
  if (await consent.isVisible()) await consent.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
test("public agent evidence filters pending trades and exposes a selectable period", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await mockConvex(page); await page.goto("/en/launch/orbit");
  await expect(page.getByRole("heading", { name: "Public execution record" })).toBeVisible();
  await expect(page.getByText("0.02 SOL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "7d", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "7d", exact: true }).click();
  await expect(page.getByRole("button", { name: "7d", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Verify recent executions").click();
  await expect(page.locator('a[href="https://solscan.io/tx/confirmed"]')).toHaveCount(1);
  await expect(page.locator('a[href="https://solscan.io/tx/pending"]')).toHaveCount(0);
  await clean(page); await page.screenshot({ path: info.outputPath("public-record.png"), fullPage: true });
  expect(errors).toEqual([]);
});
test("radar presents explicit sides, shared-source context and follow controls", async ({ page }, info) => {
  await mockConvex(page); await page.goto("/en/radar");
  await expect(page.getByRole("heading", { name: "Council radar" })).toBeVisible();
  await expect(page.getByText("Council divided", { exact: false })).toBeVisible();
  await expect(page.getByText(/2 lean Yes · 1 lean No/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow market", exact: true })).toBeDisabled();
  await clean(page); await page.screenshot({ path: info.outputPath("radar.png"), fullPage: true });
});
test("arena points to an existing daily checkpoint and market shows its resolution timeline", async ({ page }, info) => {
  await mockConvex(page); await page.goto("/en/arena");
  await expect(page.getByRole("heading", { name: "Daily checkpoints" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the current pool →" })).toHaveAttribute("href", "/en/arena/arc/pool/42");
  await page.getByRole("link", { name: "Join the current pool →" }).click();
  await expect(page.getByRole("heading", { name: "Resolution timeline" })).toBeVisible();
  await expect(page.getByText("Price rule: SOL > $150.", { exact: false })).toBeVisible();
  await clean(page); await page.screenshot({ path: info.outputPath("settlement-timeline.png"), fullPage: true });
});
