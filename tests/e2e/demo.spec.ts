import { expect, test, type Page } from "@playwright/test";
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
  await page.route("**/api/launch", async (route) => { liveCalls++; await route.fulfill({ status: 403, json: { error: "Live launch requires wallet signatures." } }); });
  await page.route("**/api/demo**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      if (new URL(request.url()).searchParams.get("view") === "showcase") return route.fulfill({ json: { enabled: true, agents: showcasePreviews(), stakes: [] } });
      return route.fulfill({ json: { enabled: true, session: { expiresAt: Date.now() + DEMO.sessionMs, agents, baskets, stakes: [] } } });
    }
    const body = request.postDataJSON();
    if (body.action === "session") return route.fulfill({ json: { ok: true } });
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

test("launch opens on five limited preview examples with disclosed positive sample returns", async ({ page }) => {
  await mockDemo(page);
  await page.goto("/en/launch");
  await expect(page.getByRole("heading", { name: "Meet our preview agents" })).toBeVisible();
  for (const { input } of SHOWCASE_AGENTS) await expect(page.getByRole("button", { name: new RegExp(input.name) })).toBeVisible();
  await expect(page.getByText("Mimir Preview · limited access · 3 free agents · 7 days", { exact: true })).toBeVisible();
  await expect(page.getByText(/Card charts and positive example returns are illustrative/)).toBeVisible();
  await page.getByRole("button", { name: /Mimir Pioneer/ }).click();
  await expect(page.getByRole("heading", { name: "Mimir Pioneer", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current paper performance" })).toBeVisible();
  await noOverflow(page);
});

for (const chain of ["solana", "arc", "robinhood"] as const) {
  test(`guest creates a ${chain} preview without a wallet and sees the go-live popup`, async ({ page }) => {
    const state = await mockDemo(page);
    await page.goto("/en/demo/new");
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
  await page.goto("/en/demo");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  expect(state.agents[0].status).toBe("paused");
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
  await page.goto(`/en/launch/new?demo=${a.id}`);
  await expect(page.getByText("Your preview strategy is ready to go live.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check and launch", exact: true })).toBeVisible();
  await expect(page.getByText(/SL 12%/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true }).last()).toBeVisible();
  await expect(page.getByLabel("Seed SOL", { exact: false })).toHaveValue("0.1");
  expect(state.liveCalls()).toBe(0);
  await noOverflow(page);
});

test("the third newly created agent opens the exhausted-allowance popup", async ({ page }) => {
  await mockDemo(page, [fixtureAgent(0), fixtureAgent(1)]);
  await page.goto("/en/demo/new");
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
    await page.goto(`/en/launch/new?demo=${a.id}`);
    await expect(page.getByText("Your preview strategy is ready to go live.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check and launch", exact: true })).toBeVisible();
    if (index === 2) await expect(page.getByText(/send 0.15 USDC on Arc/)).toBeVisible();
    else await expect(page.getByLabel("Seed ETH", { exact: false })).toHaveValue("0.1");
    await noOverflow(page);
  });
}
