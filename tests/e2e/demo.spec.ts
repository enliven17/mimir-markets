import { expect, test, type Page } from "@playwright/test";
import { registerTestWallet, connectPreviewWallet } from "./preview-wallet";
import { SHOWCASE_AGENTS, showcasePreviews } from "../../lib/demo/showcase";
import { DemoCreateBody } from "../../lib/demo/input";
import { DEFAULT_MARKET_RULES } from "../../lib/launch/markets";
import { DEMO, initialDemoState, type DemoAgent } from "../../lib/demo/types";

function fixtureAgent(index = 0): DemoAgent {
  const a = showcasePreviews()[index % 5];
  return { ...a, id: `j${String(index + 1).padStart(31, "0")}`, showcaseKey: undefined };
}
async function mockDemo(page: Page, initialAgents: DemoAgent[] = []) {
  const agents = structuredClone(initialAgents);
  const baskets: any[] = [];
  const creates: any[] = [];
  let liveCalls = 0;
  let verified = false;
  await page.addInitScript(registerTestWallet);
  await page.route("**/api/launch", async (route) => { liveCalls++; await route.fulfill({ status: 403, json: { error: "Live launch requires wallet signatures." } }); });
  await page.route("**/api/demo**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      if (new URL(request.url()).searchParams.get("view") === "showcase") return route.fulfill({ json: { enabled: true, agents: showcasePreviews(), stakes: [] } });
      if (!verified) return route.fulfill({ status: 401, json: { error: "Verify wallet" } });
      return route.fulfill({ json: { enabled: true, session: { expiresAt: Date.now() + DEMO.sessionMs, agents, baskets, stakes: [] } } });
    }
    const body = request.postDataJSON();
    if (body.action === "session") { expect(request.headers()["x-mimir-preview-owner"]).toBeTruthy(); expect(request.headers()["x-mimir-signature"]).toBeTruthy(); verified = true; return route.fulfill({ json: { ok: true } }); }
    if (body.action === "agent") {
      const b = DemoCreateBody.parse(body.input); creates.push(body.input);
      const t = b.trading;
      agents.push({ id: `j${String(agents.length + 1).padStart(31, "0")}`, name: b.name, ticker: b.ticker, avatarSeed: b.avatarSeed ?? b.ticker.toLowerCase(),
        thesis: b.thesis, chain: b.chain, status: "live", createdAt: Date.now(), expiresAt: Date.now() + DEMO.sessionMs, nextTickAt: Date.now() + DEMO.tickMs,
        trading: t.enabled ? { enabled: true, config: { ...t.strategy, thesis: b.thesis, trailingStopPct: t.trailingStopPct || null, maxHoldMinutes: t.maxHoldMinutes || null, liveView: "public", copyTrade: false }, risk: t.risk } : { enabled: false, config: null, risk: null },
        markets: { enabled: b.markets.enabled, budgetUsdc: b.markets.budgetUsdc, rules: { ...DEFAULT_MARKET_RULES, ...b.markets } }, state: initialDemoState(Date.now()) });
      return route.fulfill({ status: 201, json: { id: agents.at(-1)!.id, used: agents.length } });
    }
    if (body.action === "basket") { baskets.push({ ...body.input, id: `b${baskets.length}`, createdAt: Date.now(), totalReturn: 0, nav: 1_000 }); return route.fulfill({ status: 201, json: { id: "basket1" } }); }
    if (body.action === "status") { agents.find((a) => a.id === body.id)!.status = body.status; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ status: 400, json: { error: "Unexpected preview action." } });
  });
  return { agents, creates, liveCalls: () => liveCalls };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("a disconnected wallet cannot open the preview wizard or its saved dashboard", async ({ page }) => {
  await mockDemo(page, [fixtureAgent()]);
  await page.goto("/en/demo/new");
  await expect(page.getByRole("button", { name: "Connect wallet for Preview", exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.goto("/en/demo");
  await expect(page.getByRole("button", { name: "Connect wallet for Preview", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview agents", exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test("disconnecting a verified wallet hides private preview details immediately", async ({ page }) => {
  const a = fixtureAgent();
  await mockDemo(page, [a]);
  await page.goto(`/en/demo/${a.id}`);
  await connectPreviewWallet(page);
  await expect(page.getByRole("heading", { name: a.name, exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const w = (window as unknown as { previewTestWallet: { features: Record<string, { disconnect: () => Promise<void> }> } }).previewTestWallet;
    await w.features["standard:disconnect"].disconnect();
  });
  await expect(page.getByRole("button", { name: "Connect wallet for Preview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: a.name, exact: true })).toHaveCount(0);
});

test("the connected wallet's own preview appears on Launch and links to its detail page", async ({ page }) => {
  const a = { ...fixtureAgent(), name: "My Orbit Agent" };
  await mockDemo(page, [a]);
  await page.goto("/en/demo"); await connectPreviewWallet(page);
  await page.goto("/en/launch");
  const own = page.getByRole("region", { name: "Your preview agents", exact: true });
  await expect(own.getByRole("link", { name: /My Orbit Agent/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current paper performance" })).toHaveCount(0);
  await own.getByRole("link", { name: /My Orbit Agent/ }).click();
  await expect(page).toHaveURL(new RegExp(`/demo/${a.id}$`));
  await expect(page.getByRole("heading", { name: a.name, exact: true })).toBeVisible();
  await noOverflow(page);
});

test("token charts show actual quote samples, clickable buy/sell markers and another asset's position", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("mimir:mainnet-live-seen", "1"));
  const a = fixtureAgent(); const start = Date.now() - 3_600_000;
  a.state.cash = 9.75; a.state.pnl = 0.25;
  a.state.positions = [{ mint: "asset-b", symbol: "ORBIT", quantity: 500, cost: 0.5, entryPrice: 0.001, highPrice: 0.0013, price: 0.0012, openedAt: start }];
  a.state.trades = [
    { mint: "asset-a", symbol: "SCOUT", at: start + 2_700_000, side: "sell", price: 0.0015, amount: 0.75, pnl: 0.25, reason: "Take profit reached" },
    { mint: "asset-a", symbol: "SCOUT", at: start, side: "buy", price: 0.00103, amount: 0.5, pnl: 0, reason: "Momentum passed the entry rules" },
    { mint: "asset-b", symbol: "ORBIT", at: start, side: "buy", price: 0.001, amount: 0.5, pnl: 0, reason: "Strong liquidity" },
  ];
  a.state.priceHistory = ["asset-a", "asset-b"].map((mint) => ({ mint, symbol: mint === "asset-a" ? "SCOUT" : "ORBIT", points: Array.from({ length: 12 }, (_, i) => ({ at: start + i * 300_000, price: 0.001 + i * 0.00004 })) }));
  await mockDemo(page, [a]); await page.goto(`/en/demo/${a.id}`); await connectPreviewWallet(page);
  const consent = page.getByRole("button", { name: "I understand and accept", exact: true });
  if (await consent.isVisible()) await consent.click();
  await page.getByRole("combobox", { name: "Chart token" }).selectOption("asset-a");
  await expect(page.getByRole("button", { name: /Buy SCOUT at/ })).toBeVisible();
  await page.getByRole("button", { name: /Sell SCOUT at/ }).click();
  await expect(page.getByLabel("Selected paper fill")).toContainText("Take profit reached");
  await expect(page.getByLabel("Selected paper fill")).toContainText("0.25 SOL");
  await page.screenshot({ path: testInfo.outputPath("preview-trading-desk.png"), fullPage: true });
  await page.getByRole("button", { name: "6H", exact: true }).click();
  await page.getByRole("region", { name: "Open paper positions" }).getByRole("button", { name: /ORBIT/ }).click();
  await expect(page.getByRole("combobox", { name: "Chart token" })).toHaveValue("asset-b");
  await expect(page.getByRole("button", { name: /Buy ORBIT at/ })).toBeVisible();
  await noOverflow(page);
});

test("launch opens on five limited preview examples with disclosed positive sample returns", async ({ page }) => {
  await mockDemo(page);
  await page.goto("/en/launch");
  await expect(page.getByRole("heading", { name: "Meet our preview agents" })).toBeVisible();
  for (const { input } of SHOWCASE_AGENTS) await expect(page.getByRole("link", { name: new RegExp(input.name) })).toBeVisible();
  await expect(page.getByText("Mimir Preview · limited access · 3 free agents · 7 days", { exact: true })).toBeVisible();
  await expect(page.getByText(/Card charts and positive example returns are illustrative/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current paper performance" })).toHaveCount(0);
  await page.getByRole("link", { name: /Mimir Pioneer/ }).click();
  await expect(page).toHaveURL(/\/demo\/showcase-pioneer$/);
  await expect(page.getByRole("heading", { name: "Mimir Pioneer", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current paper performance" })).toBeVisible();
  await noOverflow(page);
});

for (const chain of ["solana", "arc", "robinhood"] as const) {
  test(`guest creates a ${chain} preview with a verified wallet and sees the go-live popup`, async ({ page }) => {
    const state = await mockDemo(page);
    await page.goto("/en/demo/new");
    await connectPreviewWallet(page);
    await page.getByRole("radio", { name: chain === "solana" ? /pump.fun/ : chain === "arc" ? /Argus/ : /Pons/ }).click();
    await page.getByLabel("Name", { exact: true }).fill(`Guest ${chain}`);
    await page.getByLabel("Ticker", { exact: true }).fill("GUEST");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Thesis", { exact: false }).fill("Back strong evidence, respect the risk limits.");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (chain === "solana") {
      await page.getByRole("switch", { name: /Trade tokens on Solana/ }).check();
      await page.getByText("Fine-tune strategy", { exact: true }).click();
      await expect(page.getByRole("button", { name: "DexScreener", exact: true })).toBeVisible();
      await noOverflow(page);
    }
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Start your preview agent" })).toBeVisible();
    await page.getByRole("button", { name: "Start preview agent", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "Your preview agent is ready" });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("link", { name: "Deploy as a real agent" })).toHaveAttribute("href", /\/launch\/new\?demo=j/);
    await popup.getByRole("button", { name: "Keep exploring the preview" }).click();
    await page.getByRole("link", { name: "Open its page", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Guest ${chain}`, exact: true })).toBeVisible();
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0].chain).toBe(chain);
    expect(state.liveCalls()).toBe(0);
    await noOverflow(page);
  });
}

test("guest controls and weighted preview basket work without live execution", async ({ page }) => {
  const agent = fixtureAgent();
  const state = await mockDemo(page, [agent]);
  await page.goto(`/en/demo/${agent.id}`);
  await connectPreviewWallet(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  expect(state.agents[0].status).toBe("paused");
  await page.goto("/en/demo");
  await page.getByLabel("Basket name", { exact: true }).fill("My preview mix");
  await page.getByLabel(`${agent.name} weight`, { exact: true }).fill("100");
  await page.getByRole("button", { name: "Create preview basket", exact: true }).click();
  await expect(page.getByText("My preview mix", { exact: true })).toBeVisible();
  await expect(page.getByText("1,000 USDC · +0.00%", { exact: true })).toBeVisible();
  expect(state.liveCalls()).toBe(0);
  await noOverflow(page);
});

test("three used preview slots show a limit popup and preserve access to existing agents", async ({ page }) => {
  await mockDemo(page, [fixtureAgent(0), fixtureAgent(1), fixtureAgent(2)]);
  await page.goto("/en/demo/new");
    await connectPreviewWallet(page);
  await expect(page.getByRole("dialog", { name: "Your 3 preview agents are ready" })).toBeVisible();
  await page.getByRole("button", { name: "Keep exploring the preview" }).click();
  await expect(page.getByRole("link", { name: "Open your preview dashboard →" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test("deploy-from-preview opens live review with the existing strategy, not the virtual balance", async ({ page }) => {
  const a = fixtureAgent();
  a.trading.risk!.stopLossPct = 12;
  a.state.cash = 999;
  const state = await mockDemo(page, [a]);
  await page.goto("/en/demo");
  await connectPreviewWallet(page);
  await page.goto(`/en/launch/new?demo=${a.id}`);
  await expect(page.getByText("Your preview strategy is ready to go live.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check and launch", exact: true })).toBeVisible();
  await expect(page.getByText(/SL 12%/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and launch", exact: true })).toBeVisible();
  await expect(page.getByLabel("Seed SOL", { exact: false })).toHaveValue("0.1");
  expect(state.liveCalls()).toBe(0);
  await noOverflow(page);
});

test("the third newly created agent opens the exhausted-allowance popup", async ({ page }) => {
  await mockDemo(page, [fixtureAgent(0), fixtureAgent(1)]);
  await page.goto("/en/demo/new");
    await connectPreviewWallet(page);
  await page.getByLabel("Name", { exact: true }).fill("Third Agent");
  await page.getByLabel("Ticker", { exact: true }).fill("THIRD");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Start preview agent", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your 3 preview agents are ready" })).toBeVisible();
  await expect(page.getByText(/You’ve used all 3 preview agent slots/)).toBeVisible();
});

for (const index of [2, 4]) {
  test(`live review preserves ${index === 2 ? "Arc" : "Robinhood"} settings and requires real funding`, async ({ page }) => {
    const a = fixtureAgent(index);
    await mockDemo(page, [a]);
    await page.goto("/en/demo");
  await connectPreviewWallet(page);
  await page.goto(`/en/launch/new?demo=${a.id}`);
    await expect(page.getByText("Your preview strategy is ready to go live.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check and launch", exact: true })).toBeVisible();
    if (index === 2) await expect(page.getByText(/send 0.15 USDC on Arc/)).toBeVisible();
    else await expect(page.getByLabel("Seed ETH", { exact: false })).toHaveValue("0.1");
    await noOverflow(page);
  });
}
