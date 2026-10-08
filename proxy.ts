import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { buildCsp, newNonce } from "./lib/server/csp";

const intl = createMiddleware(routing);

const CSP = "Content-Security-Policy";

/**
 * Locale routing (next-intl) plus the enforced CSP with a per-request nonce (lib/server/csp.ts). The policy goes on
 * the request (Next stamps the nonce on its scripts; x-nonce lets the root layout read it) and on the response.
 */
export default function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set(CSP, csp);
  headers.set("x-nonce", nonce);
  const response = intl(new NextRequest(request, { headers }));
  response.headers.set(CSP, csp);
  return response;
}

export const config = {
  // ingest: PostHog through our origin (next.config.js rewrites); a locale redirect would drop its POSTs.
  matcher: ["/", "/((?!api|ingest|trpc|_next|_vercel|.*\\..*).*)"],
};
