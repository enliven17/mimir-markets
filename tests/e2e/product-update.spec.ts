import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { seriesDraft } from "../../lib/market-series";
const now = Math.floor(Date.now() / 1000);
const draft = seriesDraft("eth-daily", 150, Date.now())!;
const market = { ...draft, chain: "base", kind: "pool", marketId: 42, status: "open", creator: "0x" + "a".repeat(40), createdAt: now - 3600,
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
        if (q.udfPath === "discovery:radar") value = [{ ...market, a: 2, b: 1, unknown: 1, disagreement: 2 / 3, updatedAt: Date.now() }];
        if (q.udfPath === "launch:card") value = { slug: "orbit", owner: "0x" + "b".repeat(40), name: "Orbit", ticker: "ORBIT", avatarSeed: "orbit", thesis: "Observe first.", status: "paused",
          brain: { kind: "mimir" }, markets: { enabled: true, budgetUsdc: 20, create: false }, arc: null, base: "0x" + "c".repeat(40), createdAt: Date.now() - 86400000,
          token: { chain: "arc", address: "0x" + "d".repeat(40), splitter: "0x" + "e".repeat(40), launchTx: "0x" + "f".repeat(64) } };
        if (q.udfPath === "launch:publicMarketRecord") value = { records: [], limited: false };
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
test("a testnet agent page shows its Base wallet and hides dormant Arc token controls", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await mockConvex(page); await page.goto("/en/launch/orbit");
  await expect(page.getByRole("heading", { name: "Orbit", level: 1 })).toBeVisible();
  await expect(page.getByText("Base wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("Arc wallet", { exact: true })).toHaveCount(0);
  await expect(page.locator(`a[href="https://arguspad.io/token/0x${"d".repeat(40)}"]`)).toHaveCount(0);
  await clean(page); await page.screenshot({ path: info.outputPath("agent-page.png"), fullPage: true });
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
  await expect(page.getByRole("link", { name: "Join the current pool →" })).toHaveAttribute("href", "/en/arena/base/pool/42");
  await page.goto("/en/arena/base/pool/42");
  await expect(page.getByRole("heading", { name: "Resolution timeline" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Price rule: ETH > $150.", { exact: false })).toBeVisible();
  await clean(page); await page.screenshot({ path: info.outputPath("settlement-timeline.png"), fullPage: true });
});
