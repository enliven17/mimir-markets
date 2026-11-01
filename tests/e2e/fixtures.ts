import { test as base, expect } from "@playwright/test";

/** Browser checks exercise the app without sending test traffic to analytics providers. */
export const test = base.extend<{ analytics: void }>({
  analytics: [async ({ page }, use) => {
    // Safari upgrades localhost assets to HTTPS under this production CSP directive,
    // but next start serves HTTP here. Keep every other directive, including nonces.
    // The request-context header test checks the original production policy.
    await page.route(/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//, async (route) => {
      if (!route.request().isNavigationRequest()) return route.fallback();
      const response = await route.fetch();
      const headers = response.headers();
      if (headers["content-security-policy"]) headers["content-security-policy"] = headers["content-security-policy"].replace(/(?:^|;\s*)upgrade-insecure-requests(?=;|$)/g, "");
      return route.fulfill({ response, headers });
    });
    await page.route(/\/(?:ingest|_vercel\/insights)\//, (route) => {
      const script = new URL(route.request().url()).pathname.endsWith(".js");
      return route.fulfill({ status: 200, contentType: script ? "application/javascript" : "application/json", body: script ? "" : "{}" });
    });
    await use();
  }, { auto: true }],
});
export { expect };
