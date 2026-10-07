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
