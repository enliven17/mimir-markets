/**
 * Content-Security-Policy-Report-Only (audit P2-6). Report-only first: the
 * wallet adapters and configurable RPC/ER endpoints make a wrong enforced
 * policy break connecting, so violations are observed before enforcing.
 *
 * Scripts are 'self' plus a per-request nonce; Next 16 reads the nonce from
 * this header on dynamically rendered pages and stamps it on its own scripts
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * Statically rendered pages carry no nonce, so their inline bootstrap shows
 * up as a report: that is the list to fix before enforcing.
 *
 * Edge-safe: no Node APIs (proxy.ts imports it).
 */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildReportOnlyCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Without a report-uri a report-only policy reports nothing (WebKit warns).
    "report-uri /api/csp-report",
  ].join("; ");
}
