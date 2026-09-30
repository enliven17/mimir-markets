import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests: every page renders without a wallet, without console
 * errors and without horizontal overflow, on desktop, mobile and WebKit, plus
 * axe-core checks (tests/e2e/a11y.spec.ts). Run against a
 * production build:
 *   npm run build && npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // iOS Safari engine: every page renders without errors or sideways overflow
    // (body uses overflow-x: clip). Only the per-route render checks run here.
    { name: "webkit", use: { ...devices["iPhone 14"] }, testMatch: /smoke\.spec\.ts/, grep: /renders cleanly/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
