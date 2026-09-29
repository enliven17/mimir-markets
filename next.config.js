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
 * Baseline security headers. No full CSP: the Solana wallet adapters inject
 * from browser extensions and the RPC/ER endpoints are configurable, and a
 * CSP that breaks connecting is worse than none. `frame-ancestors` alone
 * blocks clickjacking of the stake and sign prompts.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
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
};

module.exports = withNextIntl(nextConfig);
