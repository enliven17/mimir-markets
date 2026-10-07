import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** Everyone may crawl the site; the API, the admin panel and personal pages stay out (they are noindex too). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/en/admin", "/en/wallet", "/en/dashboard"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
