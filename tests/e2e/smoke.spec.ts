import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_CLAIM_ID, mockFixtureClaim } from "./fixtures";

/**
 * Collect uncaught page errors, console errors and failed same-origin
 * requests. The browser logs every failed request as "Failed to load
 * resource"; those are judged by their response instead: a missing asset or a
 * 4xx from our own API is a bug, while 429s and 5xx from API routes come from
 * the environment (public devnet RPC limits, no database in CI).
 */
function trackErrors(page: Page, baseURL: string | undefined): string[] {
  const origin = new URL(baseURL ?? "http://localhost").origin;
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (url.origin !== origin) return;
    const status = res.status();
    if (status < 400 || status === 429) return;
    if (status >= 500 && url.pathname.startsWith("/api/")) return;
    errors.push(`http ${status}: ${url.pathname}`);
  });
  return errors;
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const PAGES: { path: string; name: string }[] = [
  { path: "/en", name: "home" },
  { path: "/en/arena", name: "arena feed" },
  { path: `/en/arena/${FIXTURE_CLAIM_ID}`, name: "claim detail (fixture)" },
  { path: "/en/arena/create", name: "create claim" },
  { path: "/en/stats", name: "stats" },
  { path: "/en/agents", name: "agents" },
  { path: "/en/agents/new", name: "register agent" },
  { path: "/en/council", name: "council" },
  { path: "/en/calibration", name: "calibration" },
  { path: "/en/verify/1", name: "verify" },
  { path: "/en/baskets", name: "baskets" },
  { path: "/en/baskets/new", name: "compose basket" },
  { path: "/en/copy", name: "copy trading" },
  { path: "/en/dashboard", name: "dashboard" },
  { path: "/en/token", name: "token" },
  { path: "/en/docs", name: "docs" },
];

for (const { path, name } of PAGES) {
  test(`${name} renders cleanly (${path})`, async ({ page, baseURL }) => {
    const errors = trackErrors(page, baseURL);
    await mockFixtureClaim(page);
    const res = await page.goto(path, { waitUntil: "load" });
    expect(res?.status(), `HTTP status for ${path}`).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
    // Let client fetches and hydration-time effects settle.
    await page.waitForTimeout(1_500);
    expect(await horizontalOverflow(page), `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    expect(errors, `errors on ${path}`).toEqual([]);
  });
}

test("claim detail shows the fixture claim", async ({ page }) => {
  await mockFixtureClaim(page);
  await page.goto(`/en/arena/${FIXTURE_CLAIM_ID}`);
  await expect(page.getByText(/SOL trade above \$250/).first()).toBeVisible();
  // The creator's holder badge, from one batched tier request.
  await expect(page.getByText("Holder", { exact: true }).first()).toBeVisible();
});

test("dashboard shows the wallet gate when disconnected", async ({ page }) => {
  await page.goto("/en/dashboard");
  await expect(page.getByRole("button", { name: /select wallet|connect/i }).first()).toBeVisible();
});

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/en");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("health endpoint answers", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBeLessThan(600);
  const body = await res.json();
  expect(body).toBeTruthy();
});

test("create page accepts an opportunity-card prefill link", async ({ page }) => {
  const q = new URLSearchParams({
    source: "https://www.example.com/market",
    q: "Will BTC trade above $150,000 by Dec 31, 2026?",
    cat: "crypto",
  });
  await page.goto(`/en/arena/create?${q}`);
  await expect(page.getByText(/Prefilled from example\.com/)).toBeVisible();
});

test("desktop More menu opens, moves focus and closes on Escape", async ({ page, isMobile }) => {
  test.skip(isMobile, "the More menu is desktop-only; mobile uses the sheet");
  await page.goto("/en/arena");
  const more = page.getByRole("button", { name: "More" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.focus();
  await page.keyboard.press("ArrowDown");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("header").getByRole("link", { name: /^Stats/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toBeFocused();
});

test("wallet modal lists Phantom and Solflare without an extension", async ({ page, isMobile }) => {
  await page.goto("/en/arena");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator(".wallet-adapter-button-trigger:visible").first().click();
  const list = page.locator(".wallet-adapter-modal-list");
  await expect(list.getByRole("button", { name: /Phantom/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Solflare/ })).toBeVisible();
});
