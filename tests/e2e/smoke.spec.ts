import { expect, test, type Page } from "@playwright/test";

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
    // The CSP is report-only (lib/server/csp.ts): WebKit logs each would-be block
    // as a console error. Those are the reports being collected, not page errors.
    if (/^\[Report Only\]/.test(text)) return;
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
  { path: "/en/arena/create", name: "create claim" },
  { path: "/en/stats", name: "stats" },
  { path: "/en/agents", name: "agents" },
  { path: "/en/agents/new", name: "register agent" },
  { path: "/en/council", name: "council" },
  { path: "/en/launch", name: "launch" },
  { path: "/en/launch/new", name: "create agent" },
  { path: "/en/baskets", name: "baskets" },
  { path: "/en/baskets/new", name: "compose basket" },
  { path: "/en/copy", name: "copy trading" },
  { path: "/en/dashboard", name: "dashboard" },
  { path: "/en/docs", name: "docs" },
  { path: "/en/radar", name: "council radar" },
  { path: "/en/terminal", name: "terminal" },
];

for (const { path, name } of PAGES) {
  test(`${name} renders cleanly (${path})`, async ({ page, baseURL }) => {
    const errors = trackErrors(page, baseURL);
    const res = await page.goto(path, { waitUntil: "load" });
    expect(res?.status(), `HTTP status for ${path}`).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
    // Let client fetches and hydration-time effects settle.
    await page.waitForTimeout(1_500);
    expect(await horizontalOverflow(page), `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    expect(errors, `errors on ${path}`).toEqual([]);
  });
}

test("dashboard shows the wallet gate when disconnected", async ({ page }) => {
  await page.goto("/en/dashboard");
  await expect(page.getByRole("button", { name: /select wallet|connect/i }).first()).toBeVisible();
});

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/en");
  // Framing: only the site itself and Telegram's web client (the bot's Mini App).
  expect(res.headers()["content-security-policy"]).toBe("frame-ancestors 'self' https://web.telegram.org");
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
  for (const name of ["Connect an agent", "Strategies", "Stats", "Docs"]) {
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
  // Terminal leads the nav, so it takes the first focus.
  await expect(panel.getByRole("link", { name: /^Terminal/ })).toBeFocused();
  await expect(panel.getByRole("link", { name: /^Stats/ })).toBeVisible();
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

test("copy trading opens the grant form in a sheet under the strategies switch", async ({ page }) => {
  await page.addInitScript(registerTestWallet);
  await page.route("**/api/copy/permissions?probe=1", (route) => route.fulfill({ json: { enabled: true } }));
  await page.goto("/en/baskets");
  await page.getByRole("navigation", { name: "Strategies views" }).getByRole("link", { name: "Copy" }).click();
  await expect(page).toHaveURL(/\/en\/copy$/);
  await page.locator("header").getByRole("button", { name: /^Connect$/ }).click();
  await page.getByRole("dialog", { name: "Connect a wallet" }).getByRole("button", { name: /Mimir Test Wallet/ }).click();
  await expect(page.getByRole("button", { name: "Sign to load" })).toBeVisible();
  await page.getByRole("button", { name: "New permission" }).click();
  const sheet = page.getByRole("dialog", { name: "Grant a permission" });
  await expect(sheet.getByRole("button", { name: "Sign and grant" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("docs keep one section open at a time on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "desktop shows every section beside the contents list");
  await page.goto("/en/docs");
  const first = page.getByRole("button", { name: /What a claim is/ });
  const second = page.getByRole("button", { name: /Architecture/ });
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("aria-expanded", "false");
});

test("an unknown path renders the not-found page inside the shell", async ({ page }) => {
  const res = await page.goto("/en/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Nothing here.", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the arena" })).toBeVisible();
});

/**
 * Minimal injected EVM wallet, announced over EIP-6963 before the app boots. Connect resolves with one account;
 * nothing is ever signed for real.
 */
function registerTestWallet() {
  const account = "0x00000000000000000000000000000000000a11ce";
  const listeners: Record<string, ((arg: unknown) => void)[]> = {};
  const provider = {
    request: async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x4cef52"; // Arc testnet
      if (method === "net_version") return "5042002";
      if (method === "personal_sign") return `0x${"11".repeat(65)}`;
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      throw new Error(`unsupported ${method}`);
    },
    on: (event: string, fn: (arg: unknown) => void) => void (listeners[event] ??= []).push(fn),
    removeListener: (event: string, fn: (arg: unknown) => void) => void (listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn)),
  };
  const info = {
    uuid: "6f1d7a52-0000-4000-8000-000000000001",
    name: "Mimir Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    rdns: "xyz.mimirmarkets.test",
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}
