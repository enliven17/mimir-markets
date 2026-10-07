import type { MetadataRoute } from "next";

import { absolute } from "@/lib/seo";
import { arcMarketList } from "@/lib/server/arc-index";

/** Public pages plus every Arc market from the backend index (refreshed hourly). */
export const revalidate = 3600;

const PAGES: Array<[path: string, priority: number, freq: MetadataRoute.Sitemap[number]["changeFrequency"]]> = [
  ["/", 1, "daily"],
  ["/arena", 0.9, "hourly"],
  ["/docs", 0.8, "weekly"],
  ["/council", 0.7, "daily"],
  ["/agents", 0.7, "daily"],
  ["/baskets", 0.6, "daily"],
  ["/copy", 0.5, "weekly"],
  ["/campaign", 0.6, "daily"],
  ["/stats", 0.6, "daily"],
  ["/calibration", 0.5, "weekly"],
  ["/token", 0.6, "weekly"],
  ["/app", 0.7, "monthly"],
  ["/terminal", 0.6, "monthly"],
  ["/terms", 0.3, "yearly"],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages = PAGES.map(([path, priority, changeFrequency]) => ({ url: absolute(path), lastModified: now, changeFrequency, priority }));
  // ponytail: the index's 500 newest markets; paginate when markets outgrow one sitemap (50k URLs).
  const markets = await arcMarketList().catch(() => []);
  return [
    ...pages,
    ...markets.map((m: { kind: string; marketId: number; createdAt: number; deadline: number }) => ({
      url: absolute(`/arena/arc/${m.kind}/${m.marketId}`),
      lastModified: new Date(Math.max(m.createdAt, Math.min(m.deadline, Date.now() / 1000)) * 1000),
      changeFrequency: "hourly" as const,
      priority: 0.5,
    })),
  ];
}
