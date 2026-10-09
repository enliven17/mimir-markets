const createNextIntlPlugin = require("next-intl/plugin");
const fs = require("node:fs");
const path = require("node:path");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Third-party logos are not vendored (public/brand/README.md). Components only
 * request one when the file is present at build time, so a missing logo is a
 * wordmark rather than a 404 on every page view.
 */
const hasBrandAsset = (file) => fs.existsSync(path.join(__dirname, "public", "brand", file));

/**
 * The browser bundle only sees NEXT_PUBLIC_ values, inlined at build time. A
 * mainnet build without them would ship a bundle that throws on load
 * (lib/solana/config.ts refuses devnet fallbacks on mainnet): fail the build.
 */
if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() === "mainnet-beta") {
  const missing = ["NEXT_PUBLIC_MIMIR_PROGRAM_ID", "NEXT_PUBLIC_SOLANA_RPC", "NEXT_PUBLIC_MAGICBLOCK_ER_RPC"].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length) throw new Error(`Mainnet build is missing ${missing.join(", ")}`);
}

/**
 * Baseline security headers. The full Content-Security-Policy (nonce +
 * 'strict-dynamic' script-src, object-src 'none', ...) is enforced per request
 * by proxy.ts (lib/server/csp.ts); this static frame-ancestors copy covers
 * whatever the proxy does not match (static files, API routes).
 *
 * The one framer allowed is Telegram's web client, which opens the site as
 * the bot's Mini App in an iframe (the mobile and desktop apps use a webview).
 * No X-Frame-Options: it has no allow-list, and every current browser obeys
 * frame-ancestors instead.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_CMC_LOGO: hasBrandAsset("coinmarketcap.svg") ? "1" : "",
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // PostHog through our own origin (instrumentation-client.ts): /ingest/* → the region's ingestion and asset hosts.
  async rewrites() {
    const region = process.env.NEXT_PUBLIC_POSTHOG_REGION === "eu" ? "eu" : "us";
    return [
      { source: "/ingest/static/:path*", destination: `https://${region}-assets.i.posthog.com/static/:path*` },
      { source: "/ingest/:path*", destination: `https://${region}.i.posthog.com/:path*` },
    ];
  },
  // Local-only folders (brand sources and videos, the Android project, build outputs) never ship in a function.
  // The Telegram launch video lives in assets/telegram, which stays traced.
  outputFileTracingExcludes: {
    "*": ["brand/**", "android-app/**", "forge-out/**", "forge-cache/**", "test-results/**", "onchain/**", "contracts/**", ".keys/**"],
  },
  // PostHog's API paths end in a slash; a redirect would break them.
  skipTrailingSlashRedirect: true,
};

module.exports = withNextIntl(nextConfig);
