import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FIXTURE_CLAIM_ID, mockFixtureClaim } from "./fixtures";

/**
 * axe-core on every route (WCAG 2.x A/AA rules): no serious or critical
 * violations, on desktop and mobile.
 */
const ROUTES = [
  "/en",
  "/en/arena",
  `/en/arena/${FIXTURE_CLAIM_ID}`,
  "/en/arena/create",
  "/en/dashboard",
  "/en/council",
  "/en/agents",
  "/en/agents/new",
  "/en/token",
  "/en/stats",
  "/en/calibration",
  "/en/baskets",
  "/en/baskets/new",
  "/en/copy",
  "/en/verify/1",
  "/en/docs",
  "/en/no-such-page",
];

for (const path of ROUTES) {
  test(`no serious axe violations on ${path}`, async ({ page }) => {
    await mockFixtureClaim(page);
    await page.goto(path, { waitUntil: "load" });
    await expect(page.locator("h1").first()).toBeVisible();
    // Let entrances finish so axe reads final colours, not mid-fade ones.
    await page.waitForTimeout(2_500);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const bad = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join(" | ")}`);
    expect(bad, `axe on ${path}`).toEqual([]);
  });
}
