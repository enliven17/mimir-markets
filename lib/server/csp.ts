/**
 * The Content-Security-Policy, enforced (audit P2-6 / security review item 8). proxy.ts sets it per request with a
 * fresh nonce; Next 16 reads the nonce from the request's CSP header and stamps it on its own scripts, and the root
 * layout puts it on the one inline script we write (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * Pages are rendered per request for this (a static page has no request to carry a nonce).
 *
 * script-src: the nonce plus 'strict-dynamic', so only scripts we started run, and what they load (wallet adapters,
 * PostHog) inherits the trust; 'self' and https: are fallbacks for browsers without CSP3. Styles stay
 * 'unsafe-inline' (inline style attributes everywhere; a style can't run code). connect-src stays open to https and
 * wss (Arc and Solana RPCs, Circle, the backend, wallet relays are configurable endpoints). frame-ancestors keeps
 * Telegram's web client, which embeds the site as a mini app.
 *
 * Edge-safe: no Node APIs (proxy.ts imports it).
 */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' https:${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "media-src 'self' data: blob: https:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://web.telegram.org",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
  ].join("; ");
}
