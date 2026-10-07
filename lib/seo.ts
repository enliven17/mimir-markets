/**
 * Page metadata and structured data, one shape for every page: a canonical URL on the live locale, Open Graph and
 * Twitter cards (the image comes from app/[locale]/opengraph-image.tsx), and noindex for personal or gated pages.
 */
import type { Metadata } from "next";

import { SITE_URL } from "./site";

export const SITE_NAME = "Mimir Markets";
export const LOCALE = "en";

/** Where people follow Mimir; the Organization's sameAs. */
export const SAME_AS = ["https://x.com/mimirmarkets", "https://t.me/mimirmarkets", "https://github.com/enliven17/mimir-markets"] as const;

export const absolute = (path: string) => `${SITE_URL}/${LOCALE}${path === "/" ? "" : path}`;

export function pageMeta({ path, title, description, index = true }: { path: string; title: string; description: string; index?: boolean }): Metadata {
  const canonical = `/${LOCALE}${path === "/" ? "" : path}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: SITE_NAME, type: "website" },
    twitter: { card: "summary_large_image", title, description },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
  };
}

/** A BreadcrumbList for pages under a section, Home first. */
export function breadcrumbs(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, ...items].map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absolute(it.path),
    })),
  };
}

export const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/app/icon-512.png`,
  description:
    "Mimir Markets is an open-source prediction market: anyone opens a market on a claim, stakes USDC on Arc, and an AI oracle settles it in the open. Wallets and $MIMIR live on Solana.",
  sameAs: SAME_AS,
};

export const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: "en",
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
};

export function faqPage(faq: ReadonlyArray<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}
