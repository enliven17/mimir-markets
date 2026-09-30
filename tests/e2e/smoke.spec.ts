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
  // The prefill lands on step 1, filled.
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(page.getByLabel("Question")).toHaveValue(/BTC trade above \$150,000/);
});

test("arena feed has one control row and a filters popover", async ({ page }) => {
  await page.goto("/en/arena");
  const views = page.getByRole("tablist", { name: "Claims" });
  await expect(views.getByRole("tab", { name: /^Open/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("searchbox", { name: "Search claims" })).toBeVisible();
  // The old quick-filter dropdown only offered "All"; it is gone.
  await expect(page.getByRole("button", { name: "Filter view" })).toHaveCount(0);
  const filters = page.getByRole("button", { name: /^Filters/ });
  await filters.click();
  const popover = page.getByRole("dialog", { name: "Filters" });
  await expect(popover.getByText("Category")).toBeVisible();
  await expect(popover.getByText("Minimum stake")).toBeVisible();
  await expect(popover.getByRole("group", { name: "Sort" })).toBeVisible();
  await popover.getByRole("button", { name: "25+" }).click();
  await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await views.getByRole("tab", { name: /^Settled/ }).click();
  await expect(views.getByRole("tab", { name: /^Settled/ })).toHaveAttribute("aria-selected", "true");
});

test("claim detail keeps the action in view on a phone", async ({ page }) => {
  await mockFixtureClaim(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/arena/${FIXTURE_CLAIM_ID}`);
  const dock = page.getByTestId("action-dock");
  await expect(dock.getByText("Take the other side")).toBeVisible();
  await expect(dock).toBeInViewport();
  // Everything else is one tab away.
  const tabs = page.getByRole("tablist", { name: "Claim details" });
  await tabs.getByRole("tab", { name: "Terms" }).click();
  await expect(page.getByText("Market terms")).toBeVisible();
});

test("create flow validates each step and keeps the draft", async ({ page }) => {
  await page.goto("/en/arena/create", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Fill in all fields")).toBeVisible();
  await page.getByLabel("Question").fill("Will ETH trade above $5,000 on Coinbase by the deadline?");
  await page.getByLabel("Your side").fill("Yes, ETH trades above $5,000");
  await page.getByLabel("The other side").fill("No, ETH stays at or below $5,000");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 3 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Choose a future deadline")).toBeVisible();
  await page.getByRole("button", { name: "1 week" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  await expect(page.getByText("Will ETH trade above $5,000 on Coinbase by the deadline?")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Question")).toHaveValue(/Will ETH trade above/);
});

test("More sheet opens, moves focus and closes on Escape", async ({ page, isMobile }) => {
  test.skip(isMobile, "More lives in the pill on desktop; mobile uses the menu panel");
  await page.goto("/en/arena");
  const more = page.locator("header").getByRole("button", { name: "More", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.getByRole("link", { name: /^Agents/ })).toBeFocused();
  // Every page that left the pill is one click away.
  for (const name of ["Connect an agent", "Baskets", "New basket", "Copy", "Token", "Stats", "Calibration", "Docs"]) {
    await expect(sheet.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
});

test("header pill holds on app pages and marks the active link", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop links");
  await page.goto("/en/dashboard");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Portfolio" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".nav-shell")).toHaveAttribute("style", /--nav-p:\s*1/);
});

test("mobile menu panel traps focus and closes on Escape", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the burger is mobile-only");
  await page.goto("/en/arena");
  const burger = page.getByRole("button", { name: "Open menu" });
  await burger.click();
  const panel = page.locator("#mobile-nav");
  await expect(panel.getByRole("link", { name: "Arena", exact: true })).toBeFocused();
  await expect(panel.getByRole("link", { name: "Calibration" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Create a claim" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});

test("wallet sheet offers install links without an extension", async ({ page, isMobile }) => {
  await page.goto("/en/arena");
  await page.locator("header").getByRole("button", { name: /^Connect$/ }).click();
  const sheet = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(sheet).toBeVisible();
  for (const wallet of ["Phantom", "Solflare", "Backpack"]) {
    await expect(sheet.getByRole("link", { name: new RegExp(`Install ${wallet}`) })).toBeVisible();
  }
  if (isMobile) {
    // No injected wallet on a phone browser: reopen this page inside the wallet.
    await expect(sheet.getByRole("link", { name: "Open in Phantom" })).toHaveAttribute(
      "href",
      /^https:\/\/phantom\.app\/ul\/browse\//,
    );
    await expect(sheet.getByRole("link", { name: "Open in Solflare" })).toHaveAttribute(
      "href",
      /^https:\/\/solflare\.com\/ul\/v1\/browse\//,
    );
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("a Wallet Standard wallet connects from the sheet and disconnects from the chip", async ({ page }) => {
  await page.addInitScript(registerTestWallet);
  await page.goto("/en/arena");
  await page.locator("header").getByRole("button", { name: /^Connect$/ }).click();
  const sheet = page.getByRole("dialog", { name: "Connect a wallet" });
  const row = sheet.getByRole("button", { name: /Mimir Test Wallet/ });
  await expect(row).toContainText("Detected");
  await row.click();
  await expect(sheet).toBeHidden();
  const chip = page.locator("header").getByRole("button", { name: /Mimir Test Wallet wallet/ });
  await expect(chip).toContainText("…");
  await chip.click();
  const menu = page.getByRole("menu", { name: "Wallet" });
  await expect(menu.getByRole("menuitem", { name: "Copy address" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Disconnect" }).click();
  await expect(page.locator("header").getByRole("button", { name: /^Connect$/ })).toBeVisible();
});

test("portfolio opens the balance sheet from the hero when connected", async ({ page }) => {
  await page.addInitScript(registerTestWallet);
  await page.route("**/api/arena/user/**", (route) =>
    route.fulfill({ json: { success: true, data: { claims: [], indexedAt: 0 } } }),
  );
  await page.goto("/en/dashboard?tab=done");
  await page.locator("header").getByRole("button", { name: /^Connect$/ }).click();
  await page.getByRole("dialog", { name: "Connect a wallet" }).getByRole("button", { name: /Mimir Test Wallet/ }).click();
  await expect(page.getByRole("heading", { name: "Portfolio", level: 1 })).toBeVisible();
  // Filter state stays in the URL.
  await expect(page.getByRole("tablist", { name: "Positions by phase" }).getByRole("tab", { name: /^Done/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("No positions yet. Challenge a claim or publish one.")).toBeVisible();
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Balance" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("agent registration steps through four validated steps", async ({ page }) => {
  await page.goto("/en/agents/new", { waitUntil: "networkidle" });
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Use 3 to 64 lowercase letters, digits or dashes.")).toBeVisible();
  await page.getByLabel("Agent id").fill("e2e-agent");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await page.getByRole("radio", { name: /Stake/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 3 of 4")).toBeVisible();
  await page.getByRole("button", { name: /council_juror/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  // The last step recaps what the wallet will sign.
  await expect(page.getByText("council_juror")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and register" })).toBeDisabled();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Agent id")).toHaveValue("e2e-agent");
});

/**
 * Minimal Wallet Standard wallet, registered before the app boots (it answers
 * the app's `wallet-standard:app-ready` event). Connect resolves with one
 * devnet account; nothing is ever signed for real.
 */
function registerTestWallet() {
  const listeners: Record<string, ((arg: unknown) => void)[]> = {};
  const emit = (event: string, arg: unknown) => (listeners[event] ?? []).forEach((fn) => fn(arg));
  const publicKey = new Uint8Array(32).fill(7);
  const account = {
    address: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx",
    publicKey,
    chains: ["solana:devnet"],
    features: ["solana:signTransaction", "solana:signMessage"],
  };
  const wallet: Record<string, unknown> & { accounts: unknown[] } = {
    version: "1.0.0",
    name: "Mimir Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: ["solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          wallet.accounts = [account];
          emit("change", { accounts: wallet.accounts });
          return { accounts: wallet.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          wallet.accounts = [];
          emit("change", { accounts: [] });
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: string, fn: (arg: unknown) => void) => {
          (listeners[event] ??= []).push(fn);
          return () => {
            listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
          };
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          inputs.map((input) => ({ signedTransaction: input.transaction })),
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs: { message: Uint8Array }[]) =>
          inputs.map((input) => ({ signedMessage: input.message, signature: new Uint8Array(64) })),
      },
    },
  };
  const register = (api: { register: (w: unknown) => void }) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent).detail));
}
