import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { buildReportOnlyCsp, newNonce } from "./lib/server/csp";

const intl = createMiddleware(routing);

const CSP_REPORT_ONLY = "Content-Security-Policy-Report-Only";

/**
 * Locale routing (next-intl) plus a per-request nonce for the report-only CSP
 * (lib/server/csp.ts). The nonce goes on the request so Next stamps it on its
 * scripts, and the same policy goes on the response. The enforced
 * `frame-ancestors 'none'` header stays in next.config.js.
 */
export default function proxy(request: NextRequest) {
  const csp = buildReportOnlyCsp(newNonce(), process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set(CSP_REPORT_ONLY, csp);
  const response = intl(new NextRequest(request, { headers }));
  response.headers.set(CSP_REPORT_ONLY, csp);
  return response;
}

export const config = {
  matcher: ["/", "/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
