/**
 * Server-side reads of the Arc index in Convex (convex/arc.ts), for routes and
 * the Telegram bot. Plain HTTP queries; null client when Convex is not configured.
 */
import { ConvexHttpClient } from "convex/browser";

import { api } from "@/convex/_generated/api";

let client: ConvexHttpClient | null | undefined;

function convex(): ConvexHttpClient | null {
  if (client === undefined) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
    client = url ? new ConvexHttpClient(url) : null;
  }
  return client;
}

/** Every position an Arc account holds, each with its market. */
export async function arcPositions(arcAccount: string) {
  const c = convex();
  if (!c) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return c.query(api.arc.positionsOf, { user: arcAccount });
}

/** VS markets the given Arc addresses challenged, in the given statuses, each with its positions. */
export async function arcChallengedBy(wallets: string[], statuses: string[], limit: number) {
  const c = convex();
  if (!c) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return c.query(api.arcViews.challengedBy, { wallets: wallets.map((w) => w.toLowerCase()), statuses, limit });
}

/** The council's Arc wallets (slug → address), from the Convex view. */
export async function arcCouncilWallets(): Promise<Map<string, string>> {
  const c = convex();
  if (!c) return new Map();
  const rows = await c.query(api.arcViews.council, {});
  return new Map(rows.map((r) => [r.slug, r.address.toLowerCase()]));
}

export async function arcVolumeByUser(): Promise<Array<{ user: string; usdc: number }>> {
  const c = convex();
  if (!c) return [];
  return c.query(api.arcViews.volumeByUser, {});
}

export async function arcMarketList(kind?: "vs" | "pool") {
  const c = convex();
  if (!c) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return c.query(api.arc.markets, { kind, limit: 500 });
}

export async function arcMarketDetail(kind: "vs" | "pool", marketId: number) {
  const c = convex();
  if (!c) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return c.query(api.arc.market, { kind, marketId });
}
