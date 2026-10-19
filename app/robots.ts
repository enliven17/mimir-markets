import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** Everyone may crawl the site; the API (but its share cards), the admin panel and personal pages stay out (they are noindex too). */
export default function robots(): MetadataRoute.Robots {
  return {
    // The share cards live under /api: X and the other link previewers obey robots.txt, so they are allowed in by name
    // (the longer, more specific rule wins over the /api/ disallow).
    rules: [{ userAgent: "*", allow: ["/", "/api/og/", "/api/telegram/card/", "/api/telegram/markets-card"], disallow: ["/api/", "/en/admin", "/en/wallet", "/en/dashboard"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
