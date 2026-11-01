import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

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
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'self' https://web.telegram.org");
  expect(res.headers()["content-security-policy"]).toContain("upgrade-insecure-requests");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("health endpoint answers", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBeLessThan(600);
  const body = await res.json();
  expect(body).toBeTruthy();
});

test("create page gates Base transactions behind an EVM wallet", async ({ page }) => {
  await page.goto("/en/arena/create");
  await expect(page.getByRole("heading", { name: "Open a market" })).toBeVisible();
  await expect(page.getByText(/This market is on Base/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open with/ })).toHaveCount(0);
});

test("the connected create form keeps its draft when switching market kinds", async ({ page }) => {
  await page.addInitScript(registerTestWallet);
  await page.goto("/en/arena/create");
  await connectTestWallet(page);
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Will ETH trade above $5,000 at the deadline?");
  await page.getByRole("radio", { name: /Two-sided pool/ }).click();
  await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue("Will ETH trade above $5,000 at the deadline?");
  await expect(page.getByRole("textbox", { name: "Side A", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Side B", exact: true })).toBeVisible();
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
  await expect(sheet.getByRole("link", { name: /^Wallet/ })).toBeFocused();
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

test("mobile More menu opens and closes on Escape", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile navigation");
  await page.goto("/en/arena");
  const opener = page.getByRole("button", { name: "More", exact: true }).first();
  await opener.click();
  const panel = page.getByRole("dialog", { name: "More" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: /Connect an agent/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("connect sheet offers only Base Sepolia during the testnet rollout", async ({ page }) => {
  await page.goto("/en/arena");
  await page.locator("header").getByRole("button", { name: /^Connect$/ }).click();
  const sheet = page.getByRole("dialog", { name: "Connect your wallet" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Base Sepolia/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Arc/ })).toHaveCount(0);
  await expect(sheet.getByText(/Testnet: test USDC/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

async function connectTestWallet(page: Page) {
  await page.locator("header").getByRole("button", { name: /^Connect$/ }).click();
  await page.getByRole("dialog", { name: "Connect your wallet" }).getByRole("button", { name: /Base Sepolia/ }).click();
  await page.getByRole("button", { name: /Mimir Test Wallet/ }).click();
}

test("an EIP-6963 wallet connects on Base and disconnects from the chip", async ({ page }) => {
  await page.addInitScript(registerTestWallet);
  await page.goto("/en/arena");
  await connectTestWallet(page);
  const chip = page.locator("header").getByRole("button", { name: /Base wallet/ });
  await expect(chip).toBeVisible();
  await chip.click();
  const menu = page.getByRole("menu", { name: "Wallet" });
  await expect(page.getByText("USDC on Base", { exact: true })).toBeVisible();
  await expect(page.getByText("USDC on Arc", { exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Disconnect" }).click();
  await expect(page.locator("header").getByRole("button", { name: /^Connect$/ })).toBeVisible();
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

test("copy trading asks for an EVM wallet while disconnected", async ({ page }) => {
  await page.goto("/en/copy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect/i }).first()).toBeVisible();
});

test("docs describe agents staking on Base", async ({ page, isMobile }) => {
  await page.goto("/en/docs");
  if (isMobile) await page.getByRole("button", { name: /Fingerprint/ }).click();
  await expect(page.getByRole("heading", { name: /Fingerprint/, level: 3 })).toBeVisible();
  await expect(page.getByText("Today it stakes on open markets on Base, on rules you set.", { exact: true })).toBeVisible();
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
  let authorized = false;
  const listeners: Record<string, ((arg: unknown) => void)[]> = {};
  const provider = {
    request: async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") { authorized = true; return [account]; }
      if (method === "eth_accounts") return authorized ? [account] : [];
      if (method === "eth_chainId") return "0x14a34"; // Base Sepolia
      if (method === "net_version") return "84532";
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
