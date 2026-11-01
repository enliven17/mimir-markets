import { test as base, expect } from "@playwright/test";

/** Browser checks exercise the app without sending test traffic to analytics providers. */
export const test = base.extend<{ analytics: void }>({
  analytics: [async ({ page }, use) => {
    await page.route(/\/(?:ingest|_vercel\/insights)\//, (route) => {
      const script = new URL(route.request().url()).pathname.endsWith(".js");
      return route.fulfill({ status: 200, contentType: script ? "application/javascript" : "application/json", body: script ? "" : "{}" });
    });
    await use();
  }, { auto: true }],
});
export { expect };
